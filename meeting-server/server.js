const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const mediasoup = require('mediasoup');

const app = express();

// Robust CORS config
const corsOptions = {
    origin: true,
    methods: ["GET", "POST"],
    credentials: true
};
app.use(cors(corsOptions));

// Serve the locally built browser bundle
app.get('/mediasoup-client.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mediasoup-client.js'));
});
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: corsOptions,
    transports: ['websocket', 'polling'], // Support both but prioritize websocket
    allowEIO3: true // Backward compatibility if needed
});

// =====================
// GLOBAL STATE
// =====================
let worker;
const rooms = new Map(); // roomName -> { router, producers: [], consumers: [], transports: [] }

const mediaCodecs = [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    { kind: 'video', mimeType: 'video/VP8', clockRate: 90000, parameters: { 'x-google-start-bitrate': 1000 } },
];

// =====================
// START MEDIASOUP
// =====================
(async () => {
    worker = await mediasoup.createWorker({
        rtcMinPort: 10000,
        rtcMaxPort: 10100,
    });
    console.log('✅ Mediasoup Worker process started');
})();

// =====================
// SIGNALING LOGIC
// =====================
io.on('connection', (socket) => {
    console.log('👤 Connected:', socket.id, 'via', socket.conn.transport.name);

    socket.on('joinRoom', async ({ roomName }, callback) => {
        const room = await getOrCreateRoom(roomName);
        socket.join(roomName);
        socket.roomName = roomName;

        callback({ rtpCapabilities: room.router.rtpCapabilities });
    });

    socket.on('createWebRtcTransport', async ({ sender }, callback) => {
        const room = rooms.get(socket.roomName);
        const transport = await room.router.createWebRtcTransport({
            listenIps: [{ ip: '127.0.0.1' }],
            enableUdp: true, enableTcp: true, preferUdp: true,
        });

        room.transports.push({ id: transport.id, transport, socketId: socket.id, sender });
        
        callback({
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            }
        });
    });

    socket.on('transport-connect', async ({ dtlsParameters, transportId }) => {
        const room = rooms.get(socket.roomName);
        if (!room) return console.error('transport-connect: Room not found');

        const transportObj = room.transports.find(t => t.id === transportId);
        if (!transportObj) return console.error('transport-connect: Transport not found');

        await transportObj.transport.connect({ dtlsParameters });
    });

    socket.on('transport-produce', async ({ kind, rtpParameters, transportId, appData }, callback) => {
        const room = rooms.get(socket.roomName);
        if (!room) return console.error('transport-produce: Room not found');

        const transportObj = room.transports.find(t => t.id === transportId);
        if (!transportObj) return console.error('transport-produce: Transport not found');

        const producer = await transportObj.transport.produce({ kind, rtpParameters, appData });

        room.producers.push({ id: producer.id, producer, socketId: socket.id, roomName: socket.roomName });

        callback({ id: producer.id });
        socket.to(socket.roomName).emit('new-producer', { producerId: producer.id });
    });

    socket.on('transport-consume', async ({ rtpCapabilities, remoteProducerId, transportId }, callback) => {
        const room = rooms.get(socket.roomName);
        if (!room) return console.error('transport-consume: Room not found');

        const transportObj = room.transports.find(t => t.id === transportId);
        if (!transportObj) return console.error('transport-consume: Transport not found');

        if (room.router.canConsume({ producerId: remoteProducerId, rtpCapabilities })) {
            const consumer = await transportObj.transport.consume({
                producerId: remoteProducerId,
                rtpCapabilities,
                paused: true,
            });


            room.consumers.push({ id: consumer.id, consumer, socketId: socket.id });

            callback({
                params: {
                    id: consumer.id,
                    producerId: remoteProducerId,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters,
                }
            });
        }
    });

    socket.on('consumer-resume', async ({ consumerId }) => {
        const room = rooms.get(socket.roomName);
        const consumerObj = room.consumers.find(c => c.id === consumerId);
        await consumerObj.consumer.resume();
    });

    socket.on('getProducers', (callback) => {
        const room = rooms.get(socket.roomName);
        if (!room) return callback([]);
        const producerIds = room.producers.filter(p => p.socketId !== socket.id).map(p => p.id);
        callback(producerIds);
    });

    socket.on('disconnect', () => {
        const room = rooms.get(socket.roomName);
        if (!room) return;

        room.producers = room.producers.filter(p => {
            if (p.socketId === socket.id) {
                p.producer.close();
                return false;
            }
            return true;
        });
        room.transports = room.transports.filter(t => {
            if (t.socketId === socket.id) {
                t.transport.close();
                return false;
            }
            return true;
        });
        console.log('👤 Disconnected and cleaned up:', socket.id);
    });
});

async function getOrCreateRoom(roomName) {
    if (rooms.has(roomName)) return rooms.get(roomName);

    const router = await worker.createRouter({ mediaCodecs });
    const roomState = { router, producers: [], consumers: [], transports: [] };
    rooms.set(roomName, roomState);
    return roomState;
}

const PORT = 3001;
server.listen(PORT, () => console.log(`🚀 Mediasoup Master Server on port ${PORT}`));
