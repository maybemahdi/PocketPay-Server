const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const port = process.env.PORT || 5000;

const sendMail = require("./mailService");

// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174", "https://pocket-pay-client.vercel.app"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    // console.log(decoded);
    next();
  });
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nrdgddr.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const db = client.db(`${process.env.DB_USER}`);
    const userCollection = db.collection("users");
    const transactionCollection = db.collection("transactions");
    const cashInRequestCollection = db.collection("cashInRequests");
    const notificationCollection = db.collection("notifications");

    // verify admin
    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await userCollection?.findOne(query);
      if (!result || result?.role !== "admin") {
        return res.status(401).send({ message: "unauthorized access!!" });
      }
      next();
    };

    //create user - registration
    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      const { pin } = userInfo;
      // Generate salt and hash the password
      const salt = await bcrypt.genSalt(10);
      const hashedPin = await bcrypt.hash(pin, salt);
      const isExist = await userCollection.findOne({
        $or: [{ email: userInfo?.email }, { phone: userInfo?.phone }],
      });
      if (isExist) {
        return res.send({ message: "User Already Exist" });
      }
      const result = await userCollection.insertOne({
        ...userInfo,
        pin: hashedPin,
      });

      sendMail(userInfo?.email, {
        subject: "Welcome to PocketPay Instant Banking",
        message: `Thank You for joining to the fastest MFS of the region, Hope you will enjoy our services. Have A good Time!`,
      });

      res.send(result);
    });

    //sign in user - login
    app.get("/users", async (req, res) => {
      const { phoneOrEmail, pin } = req?.query;
      // Find user by username
      const query = {
        $or: [{ phone: phoneOrEmail }, { email: phoneOrEmail }],
      };
      const user = await userCollection.findOne(query, {
        projection: { _id: 0 },
      });
      if (!user) {
        return res.send({ errorMessage: "Invalid credentials" });
      }
      // Compare password with hashed password
      const isMatch = await bcrypt.compare(pin, user.pin);
      if (!isMatch) {
        return res.send({ errorMessage: "Invalid credentials" });
      }
      res
        .status(200)
        .send({ message: "Login successful", loggedIn: true, user });
    });

    // jwt
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      // console.log(user)
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // Logout
    app.post("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
        console.log("Logout successful");
      } catch (err) {
        res.status(500).send(err);
      }
    });

    //get user by phone
    app.get("/users/:phone", async (req, res) => {
      const { phone } = req?.params;
      const result = await userCollection.findOne(
        { phone },
        { projection: { _id: 0 } }
      );
      res.send(result);
    });

    // get user role
    app.get("/role/:email", async (req, res) => {
      const { email } = req?.params;
      const { role } = await userCollection.findOne({ email });
      res.send(role);
    });

    // send money
    app.put("/sendMoney", verifyToken, async (req, res) => {
      const data = req?.body;
      const validUser = await userCollection.findOne({
        phone: data?.accountNumber,
      });
      if (!validUser) {
        return res.send({ errorMessage: "Invalid User" });
      }
      const isMatch = await bcrypt.compare(data?.pin, validUser.pin);
      if (!isMatch) {
        return res.send({ errorMessage: "Wrong Pin" });
      }
      const updateReceiverBalance = {
        $inc: {
          balance: data?.amount,
        },
      };
      const updateSenderBalance = {
        $inc: {
          balance: -data?.totalPayAmount,
        },
      };
      await userCollection.updateOne(
        { phone: data?.accountNumber },
        updateReceiverBalance
      );
      await userCollection.updateOne(
        { phone: data?.sender },
        updateSenderBalance
      );
      await transactionCollection.insertOne({
        ...data,
        type: "sendMoney",
        pin: null,
        timestamp: Date.now(),
      });

      const { email: senderEmail } = await userCollection?.findOne({
        phone: data?.sender,
      });
      const { email: receiverEmail } = await userCollection?.findOne({
        phone: data?.accountNumber,
      });

      sendMail(senderEmail, {
        subject: `Send Money to ${data?.accountNumber}`,
        message: `You successfully sent ${data?.amount} BDT to ${data?.accountNumber}`,
      });

      sendMail(receiverEmail, {
        subject: `Received Money from ${data?.sender}`,
        message: `You successfully received ${data?.amount} BDT from ${data?.sender}`,
      });

      res.send({ message: "Send Money Successful" });
    });

    //cash out
    app.put("/cashOut", verifyToken, async (req, res) => {
      const data = req?.body;
      const validAgent = await userCollection.findOne({
        phone: data?.accountNumber,
        accountType: "agent",
      });
      if (!validAgent) {
        return res.send({ errorMessage: "Enter a valid agent number" });
      }
      const sender = await userCollection.findOne({ phone: data?.sender });
      const isMatch = await bcrypt.compare(data?.pin, sender?.pin);
      if (!isMatch) {
        return res.send({ errorMessage: "Wrong Pin" });
      }
      const updateReceiverBalance = {
        $inc: {
          balance: data?.amount,
        },
      };
      const updateSenderBalance = {
        $inc: {
          balance: -data?.totalPayAmount,
        },
      };
      await userCollection.updateOne(
        { phone: data?.accountNumber },
        updateReceiverBalance
      );
      await userCollection.updateOne(
        { phone: data?.sender },
        updateSenderBalance
      );
      await transactionCollection.insertOne({
        ...data,
        type: "cashOut",
        pin: null,
        timestamp: Date.now(),
      });

      const { email: senderEmail } = await userCollection?.findOne({
        phone: data?.sender,
      });
      const { email: receiverEmail } = await userCollection?.findOne({
        phone: data?.accountNumber,
      });

      sendMail(senderEmail, {
        subject: `Cash out Approved to Agent ${data?.accountNumber}`,
        message: `You successfully cash outed ${data?.amount} BDT to ${data?.accountNumber}`,
      });

      sendMail(receiverEmail, {
        subject: `Received Money from ${data?.sender}`,
        message: `You successfully received Cash Out ${data?.amount} BDT from Agent ${data?.sender}`,
      });

      res.send({ message: "Cash Out Successful" });
    });

    // send cash in req to agent
    app.post("/cashInReq", verifyToken, async (req, res) => {
      const data = req?.body;
      const validAgent = await userCollection.findOne({
        phone: data?.accountNumber,
        accountType: "agent",
      });
      if (!validAgent) {
        return res.send({ errorMessage: "Enter a valid agent number" });
      }
      const sender = await userCollection.findOne({ phone: data?.sender });
      const isMatch = await bcrypt.compare(data?.pin, sender?.pin);
      if (!isMatch) {
        return res.send({ errorMessage: "Wrong Pin" });
      }
      const result = await cashInRequestCollection.insertOne({
        ...data,
        pin: null,
        status: "pending",
        timestamp: Date.now(),
      });
      res.send({ ...result, agent: validAgent?.name });
    });

    // get all cash in requests that was done via users.
    app.get("/cashInReq/:agent", verifyToken, async (req, res) => {
      const { agent } = req?.params;
      const result = await cashInRequestCollection
        .find({ accountNumber: agent, status: "pending" })
        .sort({ timestamp: -1 })
        .toArray();
      res.send(result);
    });

    //approve cash in request
    app.put("/acceptCashIn", verifyToken, async (req, res) => {
      const data = req?.body;
      const updateStatus = {
        $set: {
          status: "completed",
        },
      };
      await cashInRequestCollection.updateOne(
        { _id: new ObjectId(data?._id) },
        updateStatus
      );
      const updateReceiverBalance = {
        $inc: {
          balance: data?.amount,
        },
      };
      const updateAgentBalance = {
        $inc: {
          balance: -data?.amount,
        },
      };
      await userCollection.updateOne(
        { phone: data?.sender },
        updateReceiverBalance
      );
      await userCollection.updateOne(
        { phone: data?.accountNumber },
        updateAgentBalance
      );
      await transactionCollection.insertOne({
        sender: data?.accountNumber,
        accountNumber: data?.sender,
        amount: data?.amount,
        fee: 0,
        pin: null,
        totalPayAmount: data?.amount,
        type: "cashIn",
        timestamp: Date.now(),
      });
      res.send({ message: "Approved" });
    });

    //decline cash in request
    app.put("/rejectCashIn/:id", verifyToken, async (req, res) => {
      const { id } = req?.params;
      const filter = { _id: new ObjectId(id) };
      const updateRejection = {
        $set: {
          status: "rejected",
        },
      };
      const result = await cashInRequestCollection.updateOne(
        filter,
        updateRejection
      );
      res.send(result);
    });

    // get transactions
    app.get("/transactions/:phone", verifyToken, async (req, res) => {
      const { phone } = req?.params;
      const sendMoney = await transactionCollection
        .find({ $or: [{ sender: phone }, { accountNumber: phone }] })
        .toArray();
      res.send(sendMoney);
    });

    //get all users for admin
    app.get("/api/allUser", verifyToken, verifyAdmin, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    //verify user (agent) by admin
    app.patch("/api/verifyStatus/:id", async (req, res) => {
      const { id } = req?.params;
      const filter = { _id: new ObjectId(id) };
      const updateStatus = {
        $set: {
          status: "verified",
        },
      };
      const result = await userCollection.updateOne(filter, updateStatus);

      const { email: senderEmail } = await userCollection?.findOne(filter);
      sendMail(senderEmail, {
        subject: `Your Agent Verification Update`,
        message: `You are a Verified Agent Now! Just Login To Your Account to get Your Login Bonus as an Agent`,
      });

      res.send(result);
    });

    //get notification for all users
    app.get("/api/notifications/:phone", async (req, res) => {
      const { phone } = req?.params;
      const notifications = await notificationCollection
        .find({ phone })
        .sort({ time: -1 })
        .toArray();
      res.send(notifications);
    });

    //mark notification as read
    app.patch(
      "/api/notification/markAsRead/:id",
      verifyToken,
      async (req, res) => {
        const { id } = req?.params;
        const { status } = req?.body;
        const filter = { _id: new ObjectId(id) };
        const updateMarkAsRead = {
          $set: {
            markAsRead: status === "read",
          },
        };
        const result = await notificationCollection.updateOne(
          filter,
          updateMarkAsRead
        );
        res.send(result);
      }
    );

    // update email
    app.patch("/api/updateEmail", verifyToken, async (req, res) => {
      const { currentEmail, newEmail, pin } = req?.body;
      const isExist = await userCollection?.findOne({ email: currentEmail });
      if (!isExist) {
        return res.status(401).send({ message: "Unauthorized Access" });
      }

      const newEmailAlreadyRegistered = await userCollection?.findOne({
        email: newEmail,
      });
      if (newEmailAlreadyRegistered) {
        return res
          .status(409)
          .send({ message: "Your New Email is Already Registered" });
      }

      // Compare password with hashed password
      const isMatch = await bcrypt.compare(pin, isExist.pin);
      if (!isMatch) {
        return res.status(401).send({ message: "Invalid credentials" });
      }

      const updateEmail = {
        $set: {
          email: newEmail,
        },
      };
      const result = await userCollection?.updateOne(isExist, updateEmail);
      
      sendMail(newEmail, {
        subject: `Pocket Pay New Email Update`,
        message: `You successfully Updated your PocketPay Email. The Past One was ${currentEmail}`,
      });
      sendMail(currentEmail, {
        subject: `Pocket Pay Email Changed`,
        message: `You successfully Changed your PocketPay Email. The new Email is ${newEmail}. If you think someone hacked your account then Contact PocketPay Support Email mh7266391@gmail.com ASAP`,
      });

      res.send(result);
    });

    // delete user (for admin)
    app.delete(
      "/api/deleteUser/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { email } = req?.params;
        const result = await userCollection?.deleteOne({ email });


        sendMail(email, {
          subject: `PocketPay Account Update`,
          message: `Your PocketPay Account has been deleted by Authority, If you did nothing wrong then contact mh7266391@gmail.com ASAP`,
        });

        res.send(result);
      }
    );

    // get notify on registering for (signing bonus)
    app.post("/api/addNotification", async (req, res) => {
      const notification = req?.body;
      const result = await notificationCollection.insertOne(notification);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from PocketPay Server...");
});

app.listen(port, () => {
  console.log(`PocketPay is running on port ${port}`);
});
