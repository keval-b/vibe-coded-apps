import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

// --- Audio System (Procedural / Web Audio API) ---

class AudioController {
  private ctx: AudioContext | null = null;
  private ambientGain: GainNode | null = null;

  constructor() {
    // We defer initialization until user interaction
  }

  init() {
    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    
    // Create context if it doesn't exist
    if (!this.ctx) {
      this.ctx = new AudioContextClass();
      this.startAmbient();
    }

    // Always try to resume if suspended (common browser policy requirement)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Generate a continuous "outdoor/room" hum using Brown Noise
  private createBrownNoise() {
    if (!this.ctx) return null;
    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + (0.02 * white)) / 1.02;
      data[i] = lastOut * 3.5; // Compensate for gain loss
    }
    return buffer;
  }

  startAmbient() {
    if (!this.ctx) return;
    const buffer = this.createBrownNoise();
    if (!buffer) return;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // Filter to make it sound like wind or distant traffic
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;

    this.ambientGain = this.ctx.createGain();
    this.ambientGain.gain.value = 0.05; // Very subtle

    source.connect(filter);
    filter.connect(this.ambientGain);
    this.ambientGain.connect(this.ctx.destination);
    source.start();
  }

  playScurry() {
    if (!this.ctx) return;
    // Short bursts of filtered noise
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    // Use noise buffer if possible, but oscillator FM synthesis is cheaper for "scratchy" sounds
    // Here we simulate scratching by modulating a triangle wave rapidly
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(800, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.1);

    // AM Modulation for texture
    const lfo = this.ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 50;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 500;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    filter.type = 'bandpass';
    filter.frequency.value = 2000;
    filter.Q.value = 1;

    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.15);
    lfo.stop(t + 0.15);
  }

  playChirp() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    // Bird chirp: Rapid frequency drop or rise
    osc.frequency.setValueAtTime(2000, t);
    osc.frequency.exponentialRampToValueAtTime(1000, t + 0.1);
    
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.1, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  playThump() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);

    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }
}

const audioController = new AudioController();

// --- Game Constants & Types ---

const PREY_SIZE = 30;
const PREY_SPEED = 12; // Pixels per frame during dash
const FRICTION = 0.92;
const IDLE_TIME_MIN = 30; // Frames
const IDLE_TIME_MAX = 120;

type Vector2 = { x: number; y: number };

type HidingSpot = {
  id: number;
  x: number;
  y: number;
  radius: number;
  type: 'rug' | 'leaves';
  color: string;
};

type Prey = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  state: 'IDLE' | 'MOVING' | 'HIDING';
  timer: number;
  target: Vector2 | null;
  type: 'mouse' | 'bird';
};

const COLORS = {
  bg: '#e8ecef',
  rug: '#a8d5ba',
  leaves: '#8fcaca',
  mouse: '#7f8c8d',
  bird: '#e74c3c',
  trail: 'rgba(200, 200, 200, 0.5)'
};

// --- Main Component ---

const App = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [audioStarted, setAudioStarted] = useState(false);
  const [score, setScore] = useState(0);

  // Game State Refs (using refs for mutable game loop state)
  const gameState = useRef({
    prey: {
      x: 300, y: 300, vx: 0, vy: 0, angle: 0, 
      state: 'IDLE', timer: 60, target: null, type: 'mouse'
    } as Prey,
    spots: [] as HidingSpot[],
    ripples: [] as { x: number, y: number, r: number, alpha: number }[],
    width: 0,
    height: 0,
    lastTime: 0
  });

  const initAudio = () => {
    audioController.init();
    if (!audioStarted) {
      setAudioStarted(true);
    }
  };

  const spawnRipple = (x: number, y: number) => {
    gameState.current.ripples.push({ x, y, r: 0, alpha: 1 });
    audioController.playThump();
  };

  const checkHit = (x: number, y: number) => {
    const { prey } = gameState.current;
    const dist = Math.hypot(prey.x - x, prey.y - y);
    
    // Hit radius slightly larger than visual
    if (dist < PREY_SIZE * 2) {
      // Caught!
      setScore(s => s + 1);
      audioController.playChirp(); // Distress chirp
      
      // Respawn logic
      const margin = 100;
      prey.x = margin + Math.random() * (gameState.current.width - margin * 2);
      prey.y = margin + Math.random() * (gameState.current.height - margin * 2);
      prey.vx = 0;
      prey.vy = 0;
      prey.state = 'IDLE';
      prey.timer = 60;
      prey.type = Math.random() > 0.5 ? 'mouse' : 'bird';
      return true;
    }
    return false;
  };

  const handleInteraction = (x: number, y: number) => {
    initAudio();
    spawnRipple(x, y);
    const hit = checkHit(x, y);
    
    // If we missed, maybe scare the prey
    if (!hit) {
      const { prey } = gameState.current;
      const dist = Math.hypot(prey.x - x, prey.y - y);
      if (dist < 200) {
        // Run away from tap
        const angle = Math.atan2(prey.y - y, prey.x - x);
        prey.vx = Math.cos(angle) * PREY_SPEED * 1.5;
        prey.vy = Math.sin(angle) * PREY_SPEED * 1.5;
        prey.state = 'MOVING';
        audioController.playScurry();
      }
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    handleInteraction(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.code === 'Space') {
      e.preventDefault(); // Stop scrolling
      // Spacebar attacks the prey directly (auto-aim for cats stepping on keyboard)
      const { prey } = gameState.current;
      handleInteraction(prey.x, prey.y);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Initialization
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resize handler
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gameState.current.width = canvas.width;
      gameState.current.height = canvas.height;
      
      // Generate spots based on screen size
      const spotCount = Math.floor((canvas.width * canvas.height) / 200000);
      gameState.current.spots = Array.from({ length: Math.max(3, spotCount) }).map((_, i) => ({
        id: i,
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: 60 + Math.random() * 60,
        type: Math.random() > 0.5 ? 'rug' : 'leaves',
        color: Math.random() > 0.5 ? COLORS.rug : COLORS.leaves
      }));
    };
    window.addEventListener('resize', resize);
    resize();

    // Game Loop
    let animationFrameId: number;

    const render = (time: number) => {
      // Calculate delta if needed, but we'll stick to frame-based for simplicity in this arcade style
      const { prey, spots, ripples, width, height } = gameState.current;

      // --- Update Physics ---

      // Ripples
      for (let i = ripples.length - 1; i >= 0; i--) {
        ripples[i].r += 5;
        ripples[i].alpha -= 0.03;
        if (ripples[i].alpha <= 0) ripples.splice(i, 1);
      }

      // Prey AI
      prey.timer--;
      
      if (prey.state === 'IDLE') {
        prey.vx *= FRICTION;
        prey.vy *= FRICTION;

        if (prey.timer <= 0) {
          // Decide next move
          prey.state = 'MOVING';
          prey.timer = 10 + Math.random() * 40; // Move duration
          
          // Pick a target: either a random spot or random point
          if (Math.random() < 0.6 && spots.length > 0) {
             const spot = spots[Math.floor(Math.random() * spots.length)];
             prey.target = { x: spot.x, y: spot.y };
          } else {
             prey.target = { 
               x: 50 + Math.random() * (width - 100), 
               y: 50 + Math.random() * (height - 100) 
             };
          }

          // Launch velocity
          const angle = Math.atan2(prey.target.y - prey.y, prey.target.x - prey.x);
          const speed = PREY_SPEED * (0.8 + Math.random() * 0.4);
          prey.vx = Math.cos(angle) * speed;
          prey.vy = Math.sin(angle) * speed;
          prey.angle = angle;
          
          // Sound trigger
          if (Math.random() > 0.3) {
             if (prey.type === 'bird') audioController.playChirp();
             else audioController.playScurry();
          }
        }
      } else if (prey.state === 'MOVING') {
        prey.x += prey.vx;
        prey.y += prey.vy;

        // Wall bounce
        if (prey.x < 0 || prey.x > width) prey.vx *= -1;
        if (prey.y < 0 || prey.y > height) prey.vy *= -1;
        
        // Face movement direction
        prey.angle = Math.atan2(prey.vy, prey.vx);

        if (prey.timer <= 0) {
           prey.state = 'IDLE';
           prey.timer = IDLE_TIME_MIN + Math.random() * (IDLE_TIME_MAX - IDLE_TIME_MIN);
           
           // Check if we ended up in a hiding spot
           const inSpot = spots.find(s => Math.hypot(s.x - prey.x, s.y - prey.y) < s.radius);
           if (inSpot) {
             prey.state = 'HIDING';
             prey.timer = 200; // Stay hidden longer
           }
        }
      } else if (prey.state === 'HIDING') {
        prey.vx *= FRICTION;
        prey.vy *= FRICTION;
        
        if (prey.timer <= 0) {
          prey.state = 'IDLE';
          prey.timer = 30; // Brief pause before emerging
        }
      }

      // --- Draw ---
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, width, height);

      // 1. Draw Hiding Spots (Base Layer)
      spots.forEach(spot => {
        ctx.fillStyle = spot.color;
        ctx.beginPath();
        if (spot.type === 'rug') {
           ctx.ellipse(spot.x, spot.y, spot.radius, spot.radius * 0.6, 0, 0, Math.PI * 2);
        } else {
           // Leaves cluster
           ctx.arc(spot.x, spot.y, spot.radius, 0, Math.PI * 2);
        }
        ctx.fill();
      });

      // 2. Draw Prey
      // If hiding, we want it to look partially obscured. 
      // Simple trick: Draw it normal, then redraw the hiding spot on top with low opacity
      
      ctx.save();
      ctx.translate(prey.x, prey.y);
      ctx.rotate(prey.angle);
      
      // Tail
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.quadraticCurveTo(-30, Math.sin(time / 50) * 10, -40, 0);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Body
      ctx.fillStyle = prey.type === 'mouse' ? COLORS.mouse : COLORS.bird;
      ctx.beginPath();
      if (prey.type === 'mouse') {
        ctx.ellipse(0, 0, 20, 12, 0, 0, Math.PI * 2);
      } else {
        // Bird shape
        ctx.moveTo(15, 0);
        ctx.lineTo(-10, 10);
        ctx.lineTo(-10, -10);
        ctx.fill();
        // Wings
        ctx.fillStyle = '#c0392b';
        ctx.beginPath();
        ctx.moveTo(-5, 0);
        ctx.lineTo(-15, 15);
        ctx.lineTo(5, 0);
        ctx.fill();
      }
      ctx.fill();
      
      // Eyes
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(10, -5, 3, 0, Math.PI * 2);
      ctx.arc(10, 5, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'black';
      ctx.beginPath();
      ctx.arc(11, -5, 1, 0, Math.PI * 2);
      ctx.arc(11, 5, 1, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // 3. Hiding Overlay (Occlusion)
      if (prey.state === 'HIDING') {
        const spot = spots.find(s => Math.hypot(s.x - prey.x, s.y - prey.y) < s.radius);
        if (spot) {
          ctx.fillStyle = spot.color;
          ctx.globalAlpha = 0.7; // Semitransparent cover
          ctx.beginPath();
          if (spot.type === 'rug') {
             ctx.ellipse(spot.x, spot.y, spot.radius, spot.radius * 0.6, 0, 0, Math.PI * 2);
          } else {
             ctx.arc(spot.x, spot.y, spot.radius, 0, Math.PI * 2);
          }
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }
      }

      // 4. Ripples
      ripples.forEach(r => {
        ctx.strokeStyle = `rgba(100, 100, 100, ${r.alpha})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.stroke();
      });

      animationFrameId = requestAnimationFrame(render);
    };
    
    animationFrameId = requestAnimationFrame(render);
    
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', userSelect: 'none', background: COLORS.bg }}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        style={{ touchAction: 'none', width: '100%', height: '100%' }}
      />
      
      {/* HUD */}
      <div style={{
        position: 'absolute',
        top: 20,
        left: 20,
        fontFamily: 'sans-serif',
        opacity: 0.5,
        pointerEvents: 'none'
      }}>
        <h1 style={{ margin: 0, fontSize: '24px', color: '#333' }}>Purrfect Pounce</h1>
        <p style={{ margin: 0, fontSize: '16px', color: '#666' }}>Score: {score}</p>
        {!audioStarted && <p style={{ fontSize: '14px', color: '#e74c3c' }}>Tap anywhere to start audio</p>}
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);