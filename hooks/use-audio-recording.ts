"use client";

import { useEffect, useRef, useState } from "react";

import { recordAudio } from "@/lib/audio-utils";

type UseAudioRecordingOptions = {
  transcribeAudio?: (blob: Blob) => Promise<string>;
  onTranscriptionComplete?: (text: string) => void;
};

export function useAudioRecording({
  transcribeAudio,
  onTranscriptionComplete,
}: UseAudioRecordingOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeechSupported, setIsSpeechSupported] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const activeRecordingRef = useRef<Promise<Blob> | null>(null);

  useEffect(() => {
    const hasMediaDevices = Boolean(
      navigator.mediaDevices && navigator.mediaDevices.getUserMedia,
    );

    setIsSpeechSupported(hasMediaDevices && Boolean(transcribeAudio));
  }, [transcribeAudio]);

  async function stopRecording() {
    setIsRecording(false);
    setIsTranscribing(true);

    try {
      recordAudio.stop();

      const recording = await activeRecordingRef.current;

      if (recording && transcribeAudio) {
        const text = await transcribeAudio(recording);
        onTranscriptionComplete?.(text);
      }
    } finally {
      setIsTranscribing(false);
      setIsListening(false);

      audioStream?.getTracks().forEach((track) => track.stop());
      setAudioStream(null);
      activeRecordingRef.current = null;
    }
  }

  async function toggleListening() {
    if (isListening) {
      await stopRecording();
      return;
    }

    try {
      setIsListening(true);
      setIsRecording(true);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      setAudioStream(stream);
      activeRecordingRef.current = recordAudio(stream);
    } catch {
      setIsListening(false);
      setIsRecording(false);
      audioStream?.getTracks().forEach((track) => track.stop());
      setAudioStream(null);
    }
  }

  return {
    isListening,
    isSpeechSupported,
    isRecording,
    isTranscribing,
    audioStream,
    toggleListening,
    stopRecording,
  };
}
