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

const { MongoClient, ServerApiVersion } = require("mongodb");
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

    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      const {pin} = userInfo
      // Generate salt and hash the password
      const salt = await bcrypt.genSalt(10);
      const hashedPin = await bcrypt.hash(pin, salt);
      const isExist = await userCollection.findOne({
        email: userInfo?.email,
        phone: userInfo?.phone,
      });
      if (isExist) {
        return res.send({ message: "User Already Exist" });
      }
      const result = await userCollection.insertOne({...userInfo, pin: hashedPin});
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
