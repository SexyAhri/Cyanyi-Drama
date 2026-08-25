"use client";

import { useEffect, useRef } from "react";

type AudioVisualizerProps = {
  stream: MediaStream | null;
  isRecording: boolean;
  onClick: () => void;
};

const audioConfig = {
  fftSize: 512,
  smoothing: 0.8,
  minBarHeight: 2,
  minBarWidth: 2,
  barSpacing: 1,
};

export function AudioVisualizer({
  stream,
  isRecording,
  onClick,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  function cleanup() {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }

  function draw(
    canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
    analyser: AnalyserNode,
  ) {
    const dpr = window.devicePixelRatio || 1;
    const frequencyData = new Uint8Array(analyser.frequencyBinCount);

    function drawFrame() {
      animationFrameRef.current = requestAnimationFrame(drawFrame);

      analyser.getByteFrequencyData(frequencyData);
      context.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

      const barWidth = Math.max(
        audioConfig.minBarWidth,
        canvas.width / dpr / frequencyData.length - audioConfig.barSpacing,
      );
      const centerY = canvas.height / dpr / 2;
      let x = 0;

      for (const value of frequencyData) {
        const normalizedHeight = value / 255;
        const barHeight = Math.max(
          audioConfig.minBarHeight,
          normalizedHeight * centerY,
        );
        const intensity = Math.floor(normalizedHeight * 155) + 100;

        context.fillStyle = `rgb(${intensity}, ${intensity}, ${intensity})`;
        context.fillRect(x, centerY - barHeight, barWidth, barHeight);
        context.fillRect(x, centerY, barWidth, barHeight);

        x += barWidth + audioConfig.barSpacing;
      }
    }

    drawFrame();
  }

  useEffect(() => cleanup, []);

  useEffect(() => {
    if (!stream || !isRecording) {
      cleanup();
      return;
    }

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();

    analyser.fftSize = audioConfig.fftSize;
    analyser.smoothingTimeConstant = audioConfig.smoothing;
    audioContext.createMediaStreamSource(stream).connect(analyser);

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (canvas && context) {
      draw(canvas, context, analyser);
    }

    return cleanup;
  }, [isRecording, stream]);

  useEffect(() => {
    function handleResize() {
      if (!canvasRef.current || !containerRef.current) {
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const rect = containerRef.current.getBoundingClientRect();

      canvasRef.current.width = (rect.width - 2) * dpr;
      canvasRef.current.height = (rect.height - 2) * dpr;
      canvasRef.current.style.width = `${rect.width - 2}px`;
      canvasRef.current.style.height = `${rect.height - 2}px`;
    }

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div
      className="h-full w-full cursor-pointer rounded-lg bg-background/80 backdrop-blur"
      onClick={onClick}
      ref={containerRef}
    >
      <canvas className="h-full w-full" ref={canvasRef} />
    </div>
  );
}
