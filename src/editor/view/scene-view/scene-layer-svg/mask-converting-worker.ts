onmessage = async (
  e: MessageEvent<[number, [number, number, number], ImageData]>,
) => {
  // (the image data was copied as it was sent to the web worker)
  // (note, however, that typed arrays are transfered, not copied)
  // https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects
  const [nodeId, [r, g, b], imageData] = e.data;

  // set image data to use the shared display color for this class
  for (let i = 0; i < imageData.data.length; i += 4) {
    imageData.data[i] = r;
    imageData.data[i + 1] = g;
    imageData.data[i + 2] = b;
    // keep alpha as is (imageData.data[i + 3])
  }

  // pass the image through canvas (to be able to convert it to a blob)
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext("2d");
  ctx?.putImageData(imageData, 0, 0);

  // export as a data URL string
  const blob = await canvas.convertToBlob();
  const dataUrl = await blobToDataURL(blob);

  // send response back
  postMessage([nodeId, dataUrl]);
};

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (_e) => resolve(reader.result as string);
    reader.onerror = (_e) => reject(reader.error);
    reader.onabort = (_e) => reject(new Error("Read aborted"));
    reader.readAsDataURL(blob);
  });
}
