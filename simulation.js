(() => {
  const canvas = document.getElementById('canvas');

  const overlayCanvas = document.getElementById('overlay');
const overlayCtx = overlayCanvas.getContext('2d');

function drawOverlay() {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  overlayCtx.beginPath();
  overlayCtx.arc(mouse.x * overlayCanvas.width, mouse.y * overlayCanvas.height, 10, 0, 2 * Math.PI);
  overlayCtx.strokeStyle = mouse.leftDown ? 'lime' : mouse.rightDown ? 'red' : 'gray';
  overlayCtx.lineWidth = 2;
  overlayCtx.stroke();
}


  let mouse = handMouse;


canvas.addEventListener('contextmenu', e => e.preventDefault());

    canvas.addEventListener('mousemove', e => {
 const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) / canvas.width;
  mouse.y = (e.clientY - rect.top) / canvas.height;
  });

  
  const gl = canvas.getContext('webgl');
  if (!gl) {
    alert('WebGL not supported!');
    return;
  }

  const NUM_PARTICLES = 1000;
  const PARTICLE_RADIUS = 5;

  const h = 0.06;
  const mass = 1;
  const restDensity = 100;
  const stiffness = 8000;
  const viscosity = 10000;
  const gravity = 0;
  const damping = 0.98;
  const dt = 0.0001;

  class Particle {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.ax = 0;
      this.ay = 0;
      this.density = 0;
      this.pressure = 0;
    }
  }

  const particles = [];
  for (let i = 0; i < NUM_PARTICLES; i++) {
    particles.push(new Particle(
      0.1 + 0.8 * Math.random(),
      0.1 + 0.8 * Math.random()
    ));
  }

  const vertexShaderSource = `
    attribute vec2 a_position;
    attribute float a_density;
    uniform vec2 u_resolution;
    uniform float u_pointSize;
    varying float v_density;
    
    void main() {
      // Convert from [0,1] to [-1,1] and flip Y
      vec2 clipSpace = (a_position * 2.0 - 1.0) * vec2(1.0, -1.0);
      gl_Position = vec4(clipSpace, 0.0, 1.0);
      gl_PointSize = u_pointSize;
      v_density = a_density;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;
    varying float v_density;
    uniform float u_restDensity;
    
    void main() {
      // Create fluid-like colors based on density
      float densityRatio = v_density / u_restDensity;
      vec3 color;
      
      if (densityRatio < 0.5) {
        color = mix(vec3(0.0, 0.2, 0.8), vec3(0.0, 0.6, 1.0), densityRatio * 2.0);
      } else {
        color = mix(vec3(0.0, 0.6, 1.0), vec3(0.8, 0.9, 1.0), (densityRatio - 0.5) * 2.0);
      }
      
      // Create circular points with smooth edges
      vec2 coord = gl_PointCoord - vec2(0.5);
      float dist = length(coord);
      
      // Smooth alpha for anti-aliasing
      float alpha = 1.0 - smoothstep(0.4, 0.5, dist);
      
      // Add specular highlight
      float highlight = pow(1.0 - dist * 1.5, 8.0) * 0.3;
      color += highlight;
      
      gl_FragColor = vec4(color, alpha);
    }
  `;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
  
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program linking failed:', gl.getProgramInfoLog(program));
  }
  
  gl.useProgram(program);

  const positionAttribute = gl.getAttribLocation(program, 'a_position');
  const densityAttribute = gl.getAttribLocation(program, 'a_density');
  const resolutionUniform = gl.getUniformLocation(program, 'u_resolution');
  const pointSizeUniform = gl.getUniformLocation(program, 'u_pointSize');
  const restDensityUniform = gl.getUniformLocation(program, 'u_restDensity');

  const positionBuffer = gl.createBuffer();
  const densityBuffer = gl.createBuffer();


  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0.1, 0.1, 0.1, 1.0);


  gl.uniform2f(resolutionUniform, canvas.width, canvas.height);
  gl.uniform1f(pointSizeUniform, PARTICLE_RADIUS * 2.5);
  gl.uniform1f(restDensityUniform, restDensity);

  function poly6Kernel(r, h) {
    if (r >= 0 && r <= h) {
      let x = (h * h - r * r);
      return 315 / (64 * Math.PI * Math.pow(h, 9)) * x * x * x;
    }
    return 0;
  }

  function spikyGradKernel(rVec, r, h) {
    if (r > 0 && r <= h) {
      const coeff = -45 / (Math.PI * Math.pow(h, 6)) * (h - r) * (h - r);
      return { x: coeff * (rVec.x / r), y: coeff * (rVec.y / r) };
    }
    return { x: 0, y: 0 };
  }

  function viscosityLapKernel(r, h) {
    if (r >= 0 && r <= h) {
      return 45 / (Math.PI * Math.pow(h, 6)) * (h - r);
    }
    return 0;
  }

  function computeDensityPressure() {
    for (let i = 0; i < NUM_PARTICLES; i++) {
      let pi = particles[i];
      let density = 0;
      for (let j = 0; j < NUM_PARTICLES; j++) {
        let pj = particles[j];
        let dx = pj.x - pi.x;
        let dy = pj.y - pi.y;
        let r = Math.sqrt(dx * dx + dy * dy);
        density += mass * poly6Kernel(r, h);
      }
      pi.density = density;
      pi.pressure = stiffness * (density - restDensity);
    }
  }

  function computeForces() {
    for (let i = 0; i < NUM_PARTICLES; i++) {
      let pi = particles[i];
      let pressureForceX = 0;
      let pressureForceY = 0;
      let viscosityForceX = 0;
      let viscosityForceY = 0;

      for (let j = 0; j < NUM_PARTICLES; j++) {
        if (i === j) continue;
        let pj = particles[j];
        let dx = pj.x - pi.x;
        let dy = pj.y - pi.y;
        let r = Math.sqrt(dx * dx + dy * dy);
        if (r < h && r > 0) {
          let grad = spikyGradKernel({ x: dx, y: dy }, r, h);
          let pressTerm = (pi.pressure + pj.pressure) / (2 * pj.density);
          pressureForceX += -mass * pressTerm * grad.x;
          pressureForceY += -mass * pressTerm * grad.y;

          let velDiffX = pj.vx - pi.vx;
          let velDiffY = pj.vy - pi.vy;
          let lap = viscosityLapKernel(r, h);
          viscosityForceX += viscosity * mass * (velDiffX / pj.density) * lap;
          viscosityForceY += viscosity * mass * (velDiffY / pj.density) * lap;
        }
      }

      pi.ax = (pressureForceX + viscosityForceX) / pi.density;
      pi.ay = (pressureForceY + viscosityForceY) / pi.density + gravity / canvas.height;
    }
  }

  function applyRepulsion() {
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const pi = particles[i];
        const pj = particles[j];
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = 0.015;
        if (dist < minDist && dist > 0) {
          const overlap = minDist - dist;
          const pushX = (dx / dist) * overlap * 0.5;
          const pushY = (dy / dist) * overlap * 0.5;
          pi.x -= pushX;
          pi.y -= pushY;
          pj.x += pushX;
          pj.y += pushY;
        }
      }
    }
  }

  function integrate() {
    const boundaryMargin = 0.025;
    const boundaryPushForce = 1;

    for (let p of particles) {
      p.vx += p.ax * dt;
      p.vy += p.ay * dt;
      p.vx *= damping;
      p.vy *= damping;
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      if (p.x < boundaryMargin) {
        p.x = boundaryMargin;
        p.vx *= -0.5;
        p.vx += boundaryPushForce;
      }
      if (p.x > 1 - boundaryMargin) {
        p.x = 1 - boundaryMargin;
        p.vx *= -0.5;
        p.vx -= boundaryPushForce;
      }
      if (p.y < boundaryMargin) {
        p.y = boundaryMargin;
        p.vy *= -0.5;
        p.vx += boundaryPushForce;
      }
      if (p.y > 1 - boundaryMargin) {
        p.y = 1 - boundaryMargin;
        p.vy *= -0.5;
        p.vx += boundaryPushForce;
      }
    }
  }

  function render() {

    const positions = new Float32Array(NUM_PARTICLES * 2);
    const densities = new Float32Array(NUM_PARTICLES);
    
    for (let i = 0; i < NUM_PARTICLES; i++) {
      const p = particles[i];
      positions[i * 2] = p.x;
      positions[i * 2 + 1] = p.y;
      densities[i] = p.density;
    }

    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.enableVertexAttribArray(positionAttribute);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0);
    
    gl.enableVertexAttribArray(densityAttribute);
    gl.bindBuffer(gl.ARRAY_BUFFER, densityBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, densities, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(densityAttribute, 1, gl.FLOAT, false, 0, 0);
  
    gl.drawArrays(gl.POINTS, 0, NUM_PARTICLES);
  }

  function applyMouseForce() {
  if (!mouse.leftDown && !mouse.rightDown) return;

  const radius = 0.2;
  const baseStrength = 100000;

  for (let p of particles) {
    const dx = p.x - mouse.x;
    const dy = p.y - mouse.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < radius && dist > 0.001) {
      const normalizedX = dx / dist;
      const normalizedY = dy / dist;
      const factor = (1 - dist / radius);

      
      if (mouse.leftDown) {
        const forceX = normalizedX * baseStrength * factor;
        const forceY = normalizedY * baseStrength * factor;
        p.vx += forceX * dt * 10;
        p.vy += forceY * dt * 10;
      }
      
      if (mouse.rightDown) {
        const forceX = -normalizedX * baseStrength * factor;
        const forceY = -normalizedY * baseStrength * factor;
        p.vx += forceX * dt * 10;
        p.vy += forceY * dt * 10;
      }
    }
  }
}


  let frameCount = 0;
  let lastTime = performance.now();
  let fps = 0;

  function updateFPS() {
    frameCount++;
    const currentTime = performance.now();
    if (currentTime - lastTime >= 1000) {
      fps = frameCount;
      frameCount = 0;
      lastTime = currentTime;
      document.getElementById('fps').textContent = fps;
    }
  }

  function loop() {
    computeDensityPressure();
    computeForces();
    integrate();
    applyRepulsion();
    applyMouseForce();
    render();
    drawOverlay();
    updateFPS();
    
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', () => {
    canvas.width = 500;
    canvas.height = 500;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(resolutionUniform, canvas.width, canvas.height);
  });

  loop();
})();
