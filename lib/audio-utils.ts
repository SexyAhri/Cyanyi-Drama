type RecordAudio = {
  (stream: MediaStream): Promise<Blob>;
  stop: () => void;
  currentRecorder?: MediaRecorder;
};

export const recordAudio = (function createRecordAudio(): RecordAudio {
  const record = async function record(stream: MediaStream): Promise<Blob> {
    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });
    const audioChunks: Blob[] = [];

    return new Promise((resolve, reject) => {
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        resolve(new Blob(audioChunks, { type: "audio/webm" }));
      };

      mediaRecorder.onerror = () => {
        reject(new Error("MediaRecorder error occurred"));
      };

      mediaRecorder.start(1000);
      (record as RecordAudio).currentRecorder = mediaRecorder;
    });
  } as RecordAudio;

  record.stop = () => {
    const recorder = record.currentRecorder;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    delete record.currentRecorder;
  };

  return record;
})();
