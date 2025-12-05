/* ============================================================
   VERCEL-COMPATIBLE MONGODB SERVER
   Madura Grandeur - Complete Backend
============================================================ */

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');

const app = express();

// =====================================================
// MIDDLEWARE
// =====================================================
app.use(express.json());
app.use(cors({
    origin: ['https://maduragrandeur.netlify.app', 'http://localhost:5500', 'http://127.0.0.1:5500'],
    credentials: true
}));

// =====================================================
// CONFIGURATION
// =====================================================
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 5000;

// Razorpay Instance
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// =====================================================
// MONGODB CONNECTION
// =====================================================
let isConnected = false;

const connectDB = async () => {
    if (isConnected) {
        console.log('✅ Using existing MongoDB connection');
        return;
    }

    try {
        const db = await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000
        });

        isConnected = db.connections[0].readyState === 1;
        console.log('✅ MongoDB Connected Successfully');
        
        // Create default admin on first connection
        await createDefaultAdmin();
    } catch (error) {
        console.error('❌ MongoDB Connection Error:', error);
        throw error;
    }
};

// =====================================================
// DATABASE SCHEMAS & MODELS
// =====================================================
const adminSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, default: 'admin' },
    createdAt: { type: Date, default: Date.now }
});

const bookingSchema = new mongoose.Schema({
    bookingId: { type: String, required: true, unique: true },
    guestName: { type: String, required: true },
    guestEmail: { type: String, required: true },
    guestPhone: { type: String, required: true },
    roomType: { type: String, required: true },
    checkIn: { type: String, required: true },
    checkOut: { type: String, required: true },
    guests: { type: Number, default: 1 },
    nights: { type: Number, required: true },
    roomPrice: { type: Number, required: true },
    totalAmount: { type: Number, required: true },
    status: { type: String, default: 'pending' },
    specialRequests: { type: String },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
    paymentStatus: { type: String, default: 'pending' },
    bookingDate: { type: Date, default: Date.now },
    cancelledDate: { type: Date }
});

const guestSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    bookings: { type: Number, default: 0 },
    lastBooking: { type: Date }
});

const roomAvailabilitySchema = new mongoose.Schema({
    standard: { type: Number, default: 10 },
    deluxe: { type: Number, default: 8 },
    suite: { type: Number, default: 5 },
    updatedAt: { type: Date, default: Date.now }
});

const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);
const Booking = mongoose.models.Booking || mongoose.model('Booking', bookingSchema);
const Guest = mongoose.models.Guest || mongoose.model('Guest', guestSchema);
const RoomAvailability = mongoose.models.RoomAvailability || mongoose.model('RoomAvailability', roomAvailabilitySchema);

// =====================================================
// HELPER FUNCTIONS
// =====================================================
async function decreaseRoomAvailability(roomType) {
    try {
        let rooms = await RoomAvailability.findOne();
        if (!rooms) {
            rooms = new RoomAvailability();
            await rooms.save();
        }
        if (rooms[roomType] > 0) {
            rooms[roomType] -= 1;
            rooms.updatedAt = new Date();
            await rooms.save();
            return { success: true, newCount: rooms[roomType] };
        }
        return { success: false, message: 'No rooms available' };
    } catch (error) {
        return { success: false, message: 'Error updating availability' };
    }
}

async function increaseRoomAvailability(roomType) {
    try {
        let rooms = await RoomAvailability.findOne();
        if (!rooms) rooms = new RoomAvailability();
        rooms[roomType] += 1;
        rooms.updatedAt = new Date();
        await rooms.save();
        return { success: true, newCount: rooms[roomType] };
    } catch (error) {
        return { success: false, message: 'Error updating availability' };
    }
}

async function createDefaultAdmin() {
    try {
        const adminCount = await Admin.countDocuments();
        if (adminCount === 0) {
            const defaultAdmin = new Admin({
                email: 'admin@maduraGrandeur.com',
                password: 'admin123',
                name: 'Administrator'
            });
            await defaultAdmin.save();
            console.log('✅ Default admin created');
        }
    } catch (error) {
        console.error('Error creating admin:', error);
    }
}

// =====================================================
// JWT VERIFICATION MIDDLEWARE
// =====================================================
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) {
        return res.status(403).json({ success: false, message: 'No token provided' });
    }
    const actualToken = token.startsWith('Bearer ') ? token.slice(7) : token;
    jwt.verify(actualToken, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }
        req.adminId = decoded.id;
        next();
    });
};

// =====================================================
// ROUTES - ADMIN
// =====================================================
app.post('/api/admin/login', async (req, res) => {
    try {
        await connectDB();
        const { email, password } = req.body;
        const admin = await Admin.findOne({ email });
        
        if (!admin || password !== admin.password) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: admin._id, email: admin.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            token,
            admin: { email: admin.email, name: admin.name, role: admin.role }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/admin/create-initial', async (req, res) => {
    try {
        await connectDB();
        const existing = await Admin.findOne({ email: 'admin@maduraGrandeur.com' });
        if (existing) {
            return res.json({ success: false, message: 'Admin already exists' });
        }
        const admin = new Admin({
            email: 'admin@maduraGrandeur.com',
            password: 'admin123',
            name: 'Administrator'
        });
        await admin.save();
        res.json({ success: true, message: 'Admin created successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// =====================================================
// ROUTES - USER PANEL
// =====================================================
app.get('/api/user/bookings/:email', async (req, res) => {
    try {
        await connectDB();
        const email = decodeURIComponent(req.params.email);
        const bookings = await Booking.find({ 
            guestEmail: { $regex: new RegExp(`^${email}$`, 'i') }
        }).sort({ bookingDate: -1 });
        res.json({ success: true, bookings });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/user/cancel-booking/:id', async (req, res) => {
    try {
        await connectDB();
        const booking = await Booking.findById(req.params.id);
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }
        if (booking.status === 'confirmed') {
            await increaseRoomAvailability(booking.roomType);
        }
        booking.status = 'cancelled';
        booking.cancelledDate = new Date();
        await booking.save();
        res.json({ success: true, booking });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/user/update-profile', async (req, res) => {
    try {
        await connectDB();
        const { email, name, phone } = req.body;
        await Booking.updateMany(
            { guestEmail: { $regex: new RegExp(`^${email}$`, 'i') } },
            { $set: { guestName: name, guestPhone: phone } }
        );
        await Guest.updateOne(
            { email: { $regex: new RegExp(`^${email}$`, 'i') } },
            { $set: { name, phone } }
        );
        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// =====================================================
// ROUTES - RAZORPAY PAYMENT
// =====================================================
app.post("/api/payment/create-order", async (req, res) => {
    try {
        await connectDB();
        const { amount, bookingData } = req.body;
        
        let rooms = await RoomAvailability.findOne();
        if (!rooms) {
            rooms = new RoomAvailability();
            await rooms.save();
        }
        
        if (rooms[bookingData.roomType] <= 0) {
            return res.status(400).json({ success: false, message: 'Room not available' });
        }
        
        const options = {
            amount: amount * 100,
            currency: "INR",
            receipt: "MG_" + Date.now(),
            notes: { bookingId: bookingData.bookingId, guestEmail: bookingData.guestEmail }
        };
        
        const order = await razorpay.orders.create(options);
        const booking = new Booking({
            ...bookingData,
            razorpayOrderId: order.id,
            status: 'pending',
            paymentStatus: 'pending'
        });
        await booking.save();
        
        res.json({ success: true, order, bookingId: booking.bookingId });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error creating order" });
    }
});

app.post("/api/payment/verify-payment", async (req, res) => {
    try {
        await connectDB();
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, bookingId } = req.body;

        const hmac = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
        hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
        const digest = hmac.digest("hex");

        if (digest === razorpay_signature) {
            const booking = await Booking.findOne({ bookingId });
            
            if (booking) {
                await decreaseRoomAvailability(booking.roomType);
                
                booking.status = 'confirmed';
                booking.paymentStatus = 'completed';
                booking.razorpayPaymentId = razorpay_payment_id;
                booking.razorpaySignature = razorpay_signature;
                await booking.save();

                let guest = await Guest.findOne({ 
                    email: { $regex: new RegExp(`^${booking.guestEmail}$`, 'i') }
                });
                
                if (guest) {
                    guest.bookings += 1;
                    guest.lastBooking = new Date();
                    await guest.save();
                } else {
                    guest = new Guest({
                        name: booking.guestName,
                        email: booking.guestEmail,
                        phone: booking.guestPhone,
                        bookings: 1,
                        lastBooking: new Date()
                    });
                    await guest.save();
                }

                res.json({ success: true, booking });
            } else {
                res.status(404).json({ success: false, message: 'Booking not found' });
            }
        } else {
            const booking = await Booking.findOne({ bookingId });
            if (booking) {
                booking.status = 'cancelled';
                booking.paymentStatus = 'failed';
                await booking.save();
            }
            res.json({ success: false, message: 'Payment verification failed' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// =====================================================
// ROUTES - BOOKINGS
// =====================================================
app.get('/api/bookings', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const bookings = await Booking.find().sort({ bookingDate: -1 });
        res.json({ success: true, bookings });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/bookings', async (req, res) => {
    try {
        await connectDB();
        const booking = new Booking(req.body);
        await booking.save();

        if (booking.status === 'confirmed') {
            await decreaseRoomAvailability(booking.roomType);
        }

        let guest = await Guest.findOne({ 
            email: { $regex: new RegExp(`^${booking.guestEmail}$`, 'i') }
        });
        
        if (guest) {
            guest.bookings += 1;
            guest.lastBooking = new Date();
            await guest.save();
        } else {
            guest = new Guest({
                name: booking.guestName,
                email: booking.guestEmail,
                phone: booking.guestPhone,
                bookings: 1,
                lastBooking: new Date()
            });
            await guest.save();
        }

        res.json({ success: true, booking });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// =====================================================
// ROUTES - GUESTS
// =====================================================
app.get('/api/guests', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const guests = await Guest.find().sort({ lastBooking: -1 });
        res.json({ success: true, guests });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// =====================================================
// ROUTES - ROOM AVAILABILITY
// =====================================================
app.get('/api/rooms', async (req, res) => {
    try {
        await connectDB();
        let rooms = await RoomAvailability.findOne();
        if (!rooms) {
            rooms = new RoomAvailability();
            await rooms.save();
        }
        res.json({ success: true, rooms });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/rooms', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const { standard, deluxe, suite } = req.body;
        let rooms = await RoomAvailability.findOne();
        
        if (!rooms) {
            rooms = new RoomAvailability({ standard, deluxe, suite });
        } else {
            rooms.standard = standard;
            rooms.deluxe = deluxe;
            rooms.suite = suite;
            rooms.updatedAt = new Date();
        }
        await rooms.save();
        res.json({ success: true, rooms });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// =====================================================
// ROUTES - STATISTICS
// =====================================================
app.get('/api/stats', verifyToken, async (req, res) => {
    try {
        await connectDB();
        const totalBookings = await Booking.countDocuments();
        const confirmedBookings = await Booking.countDocuments({ status: 'confirmed' });
        const cancelledBookings = await Booking.countDocuments({ status: 'cancelled' });
        
        const revenueData = await Booking.aggregate([
            { $match: { status: 'confirmed', paymentStatus: 'completed' } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        
        const totalRevenue = revenueData.length > 0 ? revenueData[0].total : 0;
        
        res.json({
            success: true,
            stats: { totalBookings, confirmedBookings, cancelledBookings, totalRevenue }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// =====================================================
// HEALTH CHECK
// =====================================================
app.get('/api/health', async (req, res) => {
    try {
        await connectDB();
        const adminCount = await Admin.countDocuments();
        const bookingCount = await Booking.countDocuments();
        const guestCount = await Guest.countDocuments();
        const rooms = await RoomAvailability.findOne();
        
        res.json({ 
            success: true, 
            message: 'Madura Grandeur API - Running on Vercel',
            mongodb: isConnected ? 'Connected' : 'Disconnected',
            razorpay: 'Configured',
            stats: { admins: adminCount, bookings: bookingCount, guests: guestCount },
            roomAvailability: rooms || { standard: 0, deluxe: 0, suite: 0 }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Root route
app.get('/', (req, res) => {
    res.json({
        message: 'Madura Grandeur API',
        version: '1.0.0',
        status: 'Running on Vercel',
        endpoints: {
            health: '/api/health',
            admin_login: '/api/admin/login',
            user_bookings: '/api/user/bookings/:email',
            rooms: '/api/rooms'
        }
    });
});

// Export for Vercel
module.exports = app;

// For local development
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, async () => {
        await connectDB();
        console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
}