const videoElement = document.getElementById('input_video');
const handCanvas = document.getElementById('handOverlay');
const handCtx = handCanvas.getContext('2d');

videoElement.addEventListener('loadedmetadata', () => {
  handCanvas.width = videoElement.videoWidth;
  handCanvas.height = videoElement.videoHeight;
});

const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
});

hands.onResults((results) => {
  handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    handMouse.leftDown = false;
    handMouse.rightDown = false;
    return;
  }

  const landmarks = results.multiHandLandmarks[0];
  drawHandLandmarks(landmarks, 'lime');

  const thumb = landmarks[4];
  const index = landmarks[8];
  const middle = landmarks[12];
  const ring = landmarks[16];
  const pinky = landmarks[20];
  const dx = thumb.x - index.x;
  const dy = thumb.y - index.y;
  const dz = thumb.z - index.z;
  const pinchDistance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  const isPinching = pinchDistance < 0.05;
  const isOpen = pinchDistance > 0.08;

  if (isPinching) {
    handMouse.x = (thumb.x + index.x) / 2;
    handMouse.y = 1 - (thumb.y + index.y) / 2;
    handMouse.leftDown = false;
    handMouse.rightDown = true;
  } else if (isOpen) {
    const avgX = (index.x + middle.x + ring.x + pinky.x + thumb.x) / 5;
    const avgY = (index.y + middle.y + ring.y + pinky.y + thumb.y) / 5;
    handMouse.x = avgX;
    handMouse.y = 1 - avgY;
    handMouse.leftDown = true;
    handMouse.rightDown = false;
  } else {
    handMouse.leftDown = false;
    handMouse.rightDown = false;
  }
});

function drawHandLandmarks(landmarks, color = 'white') {
  handCtx.strokeStyle = color;
  handCtx.fillStyle = color;
  handCtx.lineWidth = 2;

  for (let point of landmarks) {
    const x = point.x * handCanvas.width;
    const y = point.y * handCanvas.height;
    handCtx.beginPath();
    handCtx.arc(x, y, 4, 0, 2 * Math.PI);
    handCtx.fill();
  }

  const connections = [
    [0,1], [1,2], [2,3], [3,4],
    [5,6], [6,7], [7,8],
    [9,10], [10,11], [11,12],
    [13,14], [14,15], [15,16],
    [17,18], [18,19], [19,20],
    [0,5], [5,9], [9,13], [13,17], [17,0]
  ];

  handCtx.beginPath();
  for (let [a,b] of connections) {
    handCtx.moveTo(landmarks[a].x * handCanvas.width, landmarks[a].y * handCanvas.height);
    handCtx.lineTo(landmarks[b].x * handCanvas.width, landmarks[b].y * handCanvas.height);
  }
  handCtx.stroke();
}

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({ image: videoElement });
  },
  width: 320,
  height: 240
});

camera.start();
