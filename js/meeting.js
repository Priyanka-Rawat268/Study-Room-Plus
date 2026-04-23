const NODE_SERVER_URL = 'http://localhost:3001';
let socket;
let device;
let producerTransport;
let videoProducer;
let audioProducer;

// UI Elements
const joinOverlay = document.getElementById('joinOverlay');
const controlsBar = document.getElementById('controlsBar');
const statusText = document.getElementById('meetingStatusText');
const meetLinkInput = document.getElementById('meetLink');
const meetLinkAnchor = document.getElementById('meetLinkAnchor');
const meetLinkDisplay = document.getElementById('meetLinkDisplay');

// =====================
// INIT
// =====================
document.getElementById('joinMeetingBtn').onclick = startMeeting;
document.getElementById('leaveMeetingBtn').onclick = leaveMeeting;
document.getElementById('toggleCam').onclick = toggleCamera;
document.getElementById('toggleMic').onclick = toggleMic;

async function waitForMediasoup(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const lib = window.mediasoupClient || window.mediasoup;
        if (lib && lib.Device) return lib;
        await new Promise(r => setTimeout(r, 200)); // retry every 200ms
    }
    return null;
}

async function startMeeting() {
    const joinBtn = document.getElementById('joinMeetingBtn');
    joinBtn.textContent = '⏳ Connecting…';
    joinBtn.disabled = true;

    const MediasoupClient = await waitForMediasoup();

    if (!MediasoupClient) {
        joinBtn.textContent = '🚀 Start Live Class';
        joinBtn.disabled = false;
        alert('Could not load the meeting library. Please check your internet connection and try again.');
        return;
    }

    socket = io(NODE_SERVER_URL, {
        transports: ['websocket'],
        upgrade: false
    });

    const classroom = JSON.parse(localStorage.getItem('currentClassroom'));
    const roomName = classroom ? classroom.id : 'demo-room-' + Math.random().toString(36).substring(7);

    statusText.innerHTML = `📡 Room ID: <strong>${roomName}</strong>`;

    const currentUrl = window.location.href.split('?')[0]; 
    const shareableLink = `${currentUrl}?roomId=${roomName}`;
    meetLinkInput.value = shareableLink;
    meetLinkAnchor.href = shareableLink;
    meetLinkAnchor.textContent = "Copy & Share Link";
    meetLinkDisplay.style.display = 'block';

    socket.emit('joinRoom', { roomName }, async ({ rtpCapabilities }) => {
        // Use the detected library object
        device = new MediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });

        await createSendTransport();

        socket.emit('getProducers', (producerIds) => {
            producerIds.forEach(id => consumeProducer(id));
        });

        joinOverlay.style.display = 'none';
        controlsBar.style.display = 'flex';
        document.getElementById('localVideoWrapper').style.display = 'block';
        statusText.innerHTML = `🟢 <span style="color:#10b981">Live Session</span><br><small style="color:#6b6b9a">Room: ${roomName}</small>`;
    });

    socket.on('new-producer', ({ producerId }) => consumeProducer(producerId));
}

// =====================
// TRANSMISSION
// =====================
async function createSendTransport() {
    socket.emit('createWebRtcTransport', { sender: true }, async ({ params }) => {
        producerTransport = device.createSendTransport(params);

        producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            socket.emit('transport-connect', { dtlsParameters, transportId: producerTransport.id });
            callback();
        });

        producerTransport.on('produce', async (parameters, callback, errback) => {
            socket.emit('transport-produce', { ...parameters, transportId: producerTransport.id }, ({ id }) => callback({ id }));
        });

        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 1280, height: 720 }, 
            audio: true 
        });
        document.getElementById('localVideo').srcObject = stream;

        videoProducer = await producerTransport.produce({ track: stream.getVideoTracks()[0] });
        audioProducer = await producerTransport.produce({ track: stream.getAudioTracks()[0] });
    });
}

// =====================
// CONSUMPTION
// =====================
async function consumeProducer(remoteProducerId) {
    socket.emit('createWebRtcTransport', { sender: false }, async ({ params }) => {
        const transport = device.createRecvTransport(params);

        transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            socket.emit('transport-connect', { dtlsParameters, transportId: transport.id });
            callback();
        });

        socket.emit('transport-consume', {
            rtpCapabilities: device.rtpCapabilities,
            remoteProducerId,
            transportId: transport.id
        }, async ({ params }) => {
            const consumer = await transport.consume(params);
            socket.emit('consumer-resume', { consumerId: consumer.id });

            const remoteStream = new MediaStream([consumer.track]);
            addRemoteVideo(remoteProducerId, remoteStream);
        });
    });
}

function addRemoteVideo(id, stream) {
    const grid = document.getElementById('videoGrid');
    if (document.getElementById(`remote-${id}`)) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.id = `remote-${id}`;
    
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    
    const label = document.createElement('div');
    label.className = 'video-label';
    label.textContent = `Student ${id.slice(0,4)}`;
    
    wrapper.appendChild(video);
    wrapper.appendChild(label);
    grid.appendChild(wrapper);
}

// =====================
// CONTROLS
// =====================
async function toggleCamera() {
    const btn = document.getElementById('toggleCam');
    if (videoProducer.paused) {
        await videoProducer.resume();
        btn.classList.remove('off');
        btn.innerHTML = '📷';
    } else {
        await videoProducer.pause();
        btn.classList.add('off');
        btn.innerHTML = '🚫';
    }
}

async function toggleMic() {
    const btn = document.getElementById('toggleMic');
    if (audioProducer.paused) {
        await audioProducer.resume();
        btn.classList.remove('off');
        btn.innerHTML = '🎤';
    } else {
        await audioProducer.pause();
        btn.classList.add('off');
        btn.innerHTML = '🔇';
    }
}

function leaveMeeting() {
    if (socket) socket.disconnect();
    window.location.href = 'dashboard.html';
}
