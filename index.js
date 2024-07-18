const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const port = process.env.PORT || 5000;

// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  // console.log(token);
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
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
      res.send({ message: "Send Money Successful" });
    });

    //cash out
    app.put("/cashOut", verifyToken, async (req, res) => {
      const data = req?.body;
      const validUser = await userCollection.findOne({
        phone: data?.accountNumber,
        accountType: "agent",
      });
      if (!validUser) {
        return res.send({ errorMessage: "Enter a valid agent number" });
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
        type: "cashOut",
        pin: null,
        timestamp: Date.now(),
      });
      res.send({ message: "Cash Out Successful" });
    });

    // send cash in req to agent
    app.post("/cashInReq", verifyToken, async (req, res) => {
      const data = req?.body;
      const validUser = await userCollection.findOne({
        phone: data?.accountNumber,
        accountType: "agent",
      });
      if (!validUser) {
        return res.send({ errorMessage: "Enter a valid agent number" });
      }
      const isMatch = await bcrypt.compare(data?.pin, validUser.pin);
      if (!isMatch) {
        return res.send({ errorMessage: "Wrong Pin" });
      }
      const result = await cashInRequestCollection.insertOne({
        ...data,
        pin: null,
        status: "pending",
        timestamp: Date.now(),
      });
      res.send({ ...result, agent: validUser?.name });
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
    app.put("/rejectCashIn/:id", async (req, res) => {
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
  res.send("Hello from PocketPay Server..");
});

app.listen(port, () => {
  console.log(`PocketPay is running on port ${port}`);
});
