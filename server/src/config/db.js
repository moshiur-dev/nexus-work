import mongoose from 'mongoose';

// Connects once and reuses the connection. Vercel runs the API as functions that may start cold,
// so every request calls this; it returns at once when already connected.
let connecting = null;
export async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  connecting ??= mongoose.connect(uri).then(() => console.log('MongoDB connected'));
  try {
    await connecting;
  } catch (err) {
    connecting = null; // let the next request try again
    throw err;
  }
}
