// DOM elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startBtn = document.getElementById('startBtn');
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const screenShareBtn = document.getElementById('screenShareBtn');
const joinBtn = document.getElementById('joinBtn');
const roomIdInput = document.getElementById('roomId');
const videoContainer = document.querySelector('.video-container');

// Variables
let localStream;
let remoteStream;
let screenStream;
let peerConnections = {};
let socket;
let roomId;
let isInitiator = false;
let isScreenSharing = false;

// Initialize
init();

function init() {
  // Connect to signaling server
  socket = io();

  // Set up socket event listeners
  socket.on('existing-users', existingUsers => {
    if (existingUsers.length > 0) {
      isInitiator = true;
      existingUsers.forEach(userId => createPeerConnection(userId));
    }
  });

  socket.on('user-joined', userId => {
    if (!isInitiator) {
      createPeerConnection(userId);
    }
  });

  socket.on('signal', async data => {
    const peerConnection = peerConnections[data.sender];
    if (!peerConnection) return;

    try {
      if (data.signal.type === 'offer') {
        // Only process offer if we're not the initiator
        if (!isInitiator) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal));
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          socket.emit('signal', {
            target: data.sender,
            signal: {
              type: 'answer',
              sdp: answer.sdp
            }
          });
        }
      } 
      else if (data.signal.type === 'answer') {
        // Only process answer if we're the initiator
        if (isInitiator) {
          if (peerConnection.signalingState !== 'stable') {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal));
          }
        }
      } 
      else if (data.signal.type === 'candidate') {
        try {
          if (peerConnection.remoteDescription) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
          } else {
            // Store candidates until remote description is set
            if (!peerConnection.candidateQueue) peerConnection.candidateQueue = [];
            peerConnection.candidateQueue.push(data.signal.candidate);
          }
        } catch (e) {
          console.log("ICE candidate error:", e);
        }
      }
    } catch (err) {
      console.error('Signal handling error:', err);
    }
  });

  socket.on('user-disconnected', userId => {
    if (peerConnections[userId]) {
      peerConnections[userId].close();
      delete peerConnections[userId];
    }
    resetCall();
  });

  // Button event listeners
  startBtn.addEventListener('click', toggleCall);
  muteBtn.addEventListener('click', toggleMute);
  videoBtn.addEventListener('click', toggleVideo);
  screenShareBtn.addEventListener('click', toggleScreenShare);
  joinBtn.addEventListener('click', joinRoom);

  // Debugging
  window.addEventListener('beforeunload', endCall);
}

async function toggleCall() {
  if (startBtn.classList.contains('active')) {
    endCall();
  } else {
    await startLocalStream();
  }
}

async function startLocalStream() {
  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ 
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: true 
      });
      localVideo.srcObject = localStream;
      startBtn.innerHTML = '<i class="fas fa-phone-slash"></i>';
      startBtn.classList.add('active', 'danger');
      console.log('Local stream started');
    }
  } catch (err) {
    console.error('Error accessing media devices:', err);
    alert('Could not access camera/microphone. Please check permissions.');
  }
}

function endCall() {
  // Close all peer connections
  Object.values(peerConnections).forEach(pc => {
    pc.close();
    if (pc.candidateQueue) pc.candidateQueue = null;
  });
  peerConnections = {};
  
  // Stop all streams
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
  }
  
  // Reset UI
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  startBtn.innerHTML = '<i class="fas fa-play"></i>';
  startBtn.classList.remove('active', 'danger');
  muteBtn.classList.remove('active');
  videoBtn.classList.remove('active');
  screenShareBtn.classList.remove('active');
  roomIdInput.disabled = false;
  joinBtn.disabled = false;
  videoContainer.classList.remove('screen-sharing');
  isScreenSharing = false;
  
  // Notify server
  if (roomId) {
    socket.emit('leave', roomId);
    roomId = null;
  }
  
  console.log('Call ended');
}

function resetCall() {
  remoteVideo.srcObject = null;
}

function toggleMute() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      muteBtn.classList.toggle('active', !audioTrack.enabled);
      console.log('Audio', audioTrack.enabled ? 'unmuted' : 'muted');
    }
  }
}

function toggleVideo() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      videoBtn.classList.toggle('active', !videoTrack.enabled);
      console.log('Video', videoTrack.enabled ? 'enabled' : 'disabled');
    }
  }
}

async function toggleScreenShare() {
  if (isScreenSharing) {
    // Stop screen sharing
    screenStream.getTracks().forEach(track => track.stop());
    await switchToCamera();
    isScreenSharing = false;
    screenShareBtn.classList.remove('active');
    console.log('Screen sharing stopped');
  } else {
    // Start screen sharing
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      
      await switchToScreen(screenStream);
      isScreenSharing = true;
      screenShareBtn.classList.add('active');
      console.log('Screen sharing started');
      
      // Handle when user stops sharing via browser UI
      screenStream.getVideoTracks()[0].onended = () => {
        if (isScreenSharing) {
          toggleScreenShare();
        }
      };
    } catch (err) {
      console.error('Screen sharing error:', err);
    }
  }
}

async function switchToScreen(screenStream) {
  const screenTrack = screenStream.getVideoTracks()[0];
  for (const userId in peerConnections) {
    const sender = peerConnections[userId]
      .getSenders()
      .find(s => s.track && s.track.kind === 'video');
    if (sender) {
      await sender.replaceTrack(screenTrack);
      console.log('Replaced track with screen share');
    }
  }
}

async function switchToCamera() {
  if (!localStream) return;
  
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    for (const userId in peerConnections) {
      const sender = peerConnections[userId]
        .getSenders()
        .find(s => s.track && s.track.kind === 'video');
      if (sender) {
        await sender.replaceTrack(videoTrack);
        console.log('Restored camera track');
      }
    }
  }
}

function joinRoom() {
  roomId = roomIdInput.value.trim();
  if (!roomId) {
    alert('Please enter a room ID');
    return;
  }
  socket.emit('join', roomId);
  roomIdInput.disabled = true;
  joinBtn.disabled = true;
  console.log(`Joined room: ${roomId}`);
}

function createPeerConnection(userId) {
  console.log(`Creating peer connection with ${userId}`);
  
  const peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  });

  // Debugging handlers
  peerConnection.oniceconnectionstatechange = () => {
    console.log(`ICE state for ${userId}:`, peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === 'disconnected') {
      resetCall();
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log(`Connection state for ${userId}:`, peerConnection.connectionState);
  };

  peerConnection.onsignalingstatechange = () => {
    console.log(`Signaling state for ${userId}:`, peerConnection.signalingState);
  };

  // Add local stream to connection
  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
    console.log('Added local tracks to peer connection');
  }

  // Handle ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', {
        target: userId,
        signal: {
          type: 'candidate',
          candidate: event.candidate
        }
      });
    }
  };

  // Handle remote stream
  peerConnection.ontrack = (event) => {
    console.log('Received remote tracks:', event.streams);
    if (event.streams && event.streams[0]) {
      remoteStream = event.streams[0];
      remoteVideo.srcObject = remoteStream;
      console.log('Set remote video source');
    }
  };

  peerConnection.onnegotiationneeded = async () => {
    try {
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await peerConnection.setLocalDescription(offer);
      socket.emit('signal', {
        target: userId,
        signal: {
          type: 'offer',
          sdp: offer.sdp
        }
      });
    } catch (err) {
      console.error('Negotiation error:', err);
    }
  };

  peerConnections[userId] = peerConnection;

  // Create offer if we're the initiator
  if (isInitiator) {
    createOffer(userId);
  }
}

async function createOffer(userId) {
  console.log(`Creating offer for ${userId}`);
  try {
    const offer = await peerConnections[userId].createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await peerConnections[userId].setLocalDescription(offer);
    socket.emit('signal', {
      target: userId,
      signal: {
        type: 'offer',
        sdp: offer.sdp
      }
    });
    console.log('Offer created and sent');
  } catch (err) {
    console.error('Offer creation error:', err);
  }
}