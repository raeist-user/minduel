const mongoose = require('mongoose');

const RETRY_DELAY_MS = 5000;

// Keeps retrying instead of killing the process, so the app (and any
// requests hitting it) stay alive with a clear error instead of a 502
// while MongoDB is unreachable (e.g. Atlas IP whitelist not applied yet).
const connectDB = () => {
  mongoose
    .connect(process.env.MONGO_URI)
    .then((conn) => {
      console.log(`MongoDB connected: ${conn.connection.host}`);
    })
    .catch((err) => {
      console.error(`MongoDB connection error: ${err.message}`);
      console.error(`Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      setTimeout(connectDB, RETRY_DELAY_MS);
    });
};

mongoose.connection.on('disconnected', () => {
  console.error('MongoDB disconnected. Attempting to reconnect...');
});

module.exports = connectDB;
