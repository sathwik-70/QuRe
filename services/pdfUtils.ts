import { jsPDF } from "jspdf";

export const convertToPdf = async (file: File): Promise<File> => {
  // If already PDF, return as is
  if (file.type === 'application/pdf') {
    return file;
  }

  // Use the standard ES module import
  const doc = new jsPDF();
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();

  try {
    if (file.type.startsWith('image/')) {
      const imgData = await readFileAsDataURL(file);
      const imgProps = doc.getImageProperties(imgData);

      // Calculate aspect ratio to fit page
      const ratio = imgProps.width / imgProps.height;
      let w = width - 20; // 10px margin
      let h = w / ratio;

      if (h > height - 20) {
        h = height - 20;
        w = h * ratio;
      }

      const format = file.type === 'image/png' ? 'PNG' : 'JPEG';
      doc.addImage(imgData, format, 10, 10, w, h, undefined, 'FAST');
    } else {
      // Best-effort conversion for text and other recognizable text-based formats
      const text = await readFileAsText(file);
      const splitText = doc.splitTextToSize(text, width - 20);

      let yPosition = 10;
      for (let i = 0; i < splitText.length; i++) {
        if (yPosition > height - 20) {
          doc.addPage();
          yPosition = 10;
        }
        doc.text(splitText[i], 10, yPosition);
        yPosition += 7; // approximate line height in points
      }
    }

    const pdfBlob = doc.output('blob');
    const newName = file.name.replace(/\.[^/.]+$/, "") + ".pdf";
    return new File([pdfBlob], newName, { type: 'application/pdf' });

  } catch (e: any) {
    console.error("PDF Conversion Failed", e);
    // Explicitly fail so we do not upload a mismatched mimetype to the patient dashboard
    throw new Error("Could not convert file to PDF. Please upload valid Image, Text, or PDF documents.");
  }
};

const readFileAsDataURL = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
};