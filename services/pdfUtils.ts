import { jsPDF } from "jspdf";

export const convertToPdf = async (file: File): Promise<File> => {
  // If already PDF, return as is
  if (file.type === 'application/pdf') {
    return file;
  }

  // Robust initialization for jsPDF from ESM CDN
  // Some ESM builds export default, others named. 
  // This ensures we get the class constructor.
  const JsPDFClass = jsPDF || (window as any).jspdf?.jsPDF || (window as any).jsPDF;

  if (!JsPDFClass) {
     throw new Error("PDF Engine failed to load.");
  }

  const doc = new JsPDFClass();
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

      // Use FAST compression to speed up client-side generation
      doc.addImage(imgData, 'JPEG', 10, 10, w, h, undefined, 'FAST');
    } else if (file.type === 'text/plain') {
      const text = await readFileAsText(file);
      const splitText = doc.splitTextToSize(text, width - 20);
      doc.text(splitText, 10, 10);
    } else {
      // Fallback for unsupported types: create a PDF with a note
      doc.text(`File: ${file.name}`, 10, 20);
      doc.text("Format conversion not fully supported for this file type.", 10, 30);
    }

    const pdfBlob = doc.output('blob');
    // Swap extension
    const newName = file.name.replace(/\.[^/.]+$/, "") + ".pdf";
    return new File([pdfBlob], newName, { type: 'application/pdf' });

  } catch (e) {
    console.error("PDF Conversion Failed", e);
    // If conversion fails, return original file to avoid data loss
    return file;
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