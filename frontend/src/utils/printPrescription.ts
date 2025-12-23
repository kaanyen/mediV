import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type PrescriptionForPrint = {
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions?: string | null;
  warnings?: string | null;
};

export type PatientForPrint = {
  name: string;
  age?: number;
  sex?: string;
};

export type VitalsForPrint = {
  bp?: string;
  temp?: string;
  pulse?: string;
  spo2?: string;
  weight?: string;
};

type PrintOptions = {
  patient: PatientForPrint;
  diagnosisSummary: string;
  vitals?: VitalsForPrint;
  prescriptions: PrescriptionForPrint[];
};

export function printPrescriptionPdf(opts: PrintOptions) {
  const { patient, diagnosisSummary, vitals, prescriptions } = opts;

  const doc = new jsPDF();
  const today = new Date().toLocaleString();

  // Header
  doc.setFontSize(18);
  doc.setTextColor(16, 185, 129); // emerald-500
  doc.setFont("helvetica", "bold");
  doc.text("MediVoice Prescription", 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.setFont("helvetica", "normal");
  doc.text(`Date: ${today}`, 160, 20);

  let currentY = 32;

  // Patient info section
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.text("Patient Details", 14, currentY);
  currentY += 6;
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Name: ${patient.name}`, 14, currentY);
  const patientInfo: string[] = [];
  if (typeof patient.age === "number") {
    patientInfo.push(`Age: ${patient.age}`);
  }
  if (patient.sex) {
    patientInfo.push(`Sex: ${patient.sex}`);
  }
  if (patientInfo.length > 0) {
    doc.text(patientInfo.join(" | "), 60, currentY);
  }
  currentY += 8;

  // Diagnosis section - always show
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0);
  doc.text("Diagnosis", 14, currentY);
  currentY += 6;
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const diagnosisText = diagnosisSummary && diagnosisSummary.trim() 
    ? diagnosisSummary.trim() 
    : "Diagnosis not recorded";
  const diagLines = doc.splitTextToSize(diagnosisText, 180);
  doc.text(diagLines, 14, currentY);
  currentY += diagLines.length * 5 + 4;

  // Vitals summary (if available) - styled box that fits page width
  if (vitals) {
    const vitalsData: Array<{label: string, value: string}> = [];
    if (vitals.bp) vitalsData.push({ label: "BP", value: vitals.bp });
    if (vitals.temp) vitalsData.push({ label: "Temp", value: `${vitals.temp}°C` });
    if (vitals.pulse) vitalsData.push({ label: "Pulse", value: `${vitals.pulse} bpm` });
    if (vitals.spo2) vitalsData.push({ label: "SpO₂", value: `${vitals.spo2}%` });
    if (vitals.weight) vitalsData.push({ label: "Weight", value: `${vitals.weight} kg` });

    if (vitalsData.length > 0) {
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0);
      doc.text("Vitals", 14, currentY);
      currentY += 6;
      
      // Create a styled box for vitals
      const boxWidth = 180;
      const itemsPerRow = 3; // 3 items per row to fit page width
      const itemWidth = boxWidth / itemsPerRow;
      const rowHeight = 8;
      const numRows = Math.ceil(vitalsData.length / itemsPerRow);
      const boxHeight = numRows * rowHeight + 4;
      
      // Draw vitals box with light gray background
      doc.setFillColor(249, 250, 251); // gray-50
      doc.setDrawColor(209, 213, 219); // gray-300
      doc.setLineWidth(0.3);
      doc.roundedRect(14, currentY, boxWidth, boxHeight, 2, 2, "FD");
      
      // Display vitals in a grid layout
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      
      vitalsData.forEach((vital, index) => {
        const row = Math.floor(index / itemsPerRow);
        const col = index % itemsPerRow;
        const x = 18 + (col * itemWidth);
        const y = currentY + 4 + (row * rowHeight);
        
        // Label in bold
        doc.setFont("helvetica", "bold");
        doc.setTextColor(75, 85, 99); // gray-600
        doc.text(`${vital.label}:`, x, y);
        
        // Value in normal
        doc.setFont("helvetica", "normal");
        doc.setTextColor(0, 0, 0);
        const labelWidth = doc.getTextWidth(`${vital.label}:`);
        doc.text(vital.value, x + labelWidth + 2, y);
      });
      
      currentY += boxHeight + 6;
    }
  }

  // Prescription table with expanded columns
  const tableBody = (prescriptions || []).map((p) => [
    p.medication || "—",
    p.dosage || "—",
    p.frequency || "—",
    p.duration || "—"
  ]);

  if (tableBody.length > 0) {
    autoTable(doc, {
      startY: currentY,
      head: [["Medication", "Dosage", "Frequency", "Duration"]],
      body: tableBody,
      styles: { 
        fontSize: 9,
        cellPadding: 3,
        overflow: "linebreak"
      },
      headStyles: { 
        fillColor: [16, 185, 129],
        textColor: [255, 255, 255],
        fontStyle: "bold"
      },
      columnStyles: {
        0: { cellWidth: 60 },
        1: { cellWidth: 50 },
        2: { cellWidth: 40 },
        3: { cellWidth: 40 }
      },
      margin: { left: 14, right: 14 }
    });
    currentY = (doc as any).lastAutoTable.finalY + 8;
  }

  // Instructions & warnings per drug - stylish layout with boxes
  prescriptions.forEach((p, index) => {
    // Add spacing between medications
    if (index > 0) {
      currentY += 6;
    }

    // Check if we need a new page
    if (currentY > 240) {
      doc.addPage();
      currentY = 20;
    }

    // Medication name as header with underline
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(16, 185, 129); // emerald-500
    doc.text(p.medication || "Medication", 14, currentY);
    
    // Draw underline
    doc.setDrawColor(16, 185, 129);
    doc.setLineWidth(0.5);
    doc.line(14, currentY + 1, 100, currentY + 1);
    currentY += 8;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");

    // Create a two-column layout for instructions and warnings
    const hasInstructions = p.instructions && p.instructions.trim().length > 0;
    const hasWarnings = p.warnings && p.warnings.trim().length > 0;

    if (hasInstructions || hasWarnings) {
      const boxWidth = 88; // Half page width minus margins
      const boxHeight = 35; // Initial height, will adjust
      const leftBoxX = 14;
      const rightBoxX = 106;

      // Instructions box (left side) - styled with light blue background
      if (hasInstructions) {
        const instructionsText = p.instructions.trim();
        const wrapped = doc.splitTextToSize(instructionsText, boxWidth - 8);
        const actualHeight = Math.max(25, wrapped.length * 4 + 10);

        // Draw rounded rectangle effect with background
        doc.setFillColor(240, 249, 255); // light blue background
        doc.setDrawColor(59, 130, 246); // blue border
        doc.setLineWidth(0.3);
        doc.roundedRect(leftBoxX, currentY, boxWidth, actualHeight, 2, 2, "FD"); // FD = fill and draw

        // Instructions label
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(30, 64, 175); // blue-800
        doc.text("Instructions", leftBoxX + 4, currentY + 6);

        // Instructions text
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(30, 58, 138); // blue-900
        doc.text(wrapped, leftBoxX + 4, currentY + 12);

        // Update currentY for warnings if they exist
        if (hasWarnings) {
          // Warnings box (right side) - styled with light red background
          const warningsText = p.warnings.trim();
          const wrappedWarn = doc.splitTextToSize(warningsText, boxWidth - 8);
          const warnHeight = Math.max(25, wrappedWarn.length * 4 + 10);
          const maxHeight = Math.max(actualHeight, warnHeight);

          // Draw rounded rectangle for warnings
          doc.setFillColor(254, 242, 242); // light red background
          doc.setDrawColor(220, 38, 38); // red border
          doc.roundedRect(rightBoxX, currentY, boxWidth, maxHeight, 2, 2, "FD");

          // Warnings label
          doc.setFontSize(9);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(153, 27, 27); // red-800
          doc.text("Warnings", rightBoxX + 4, currentY + 6);

          // Warnings text
          doc.setFontSize(8);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(127, 29, 29); // red-900
          doc.text(wrappedWarn, rightBoxX + 4, currentY + 12);

          currentY += maxHeight + 4;
        } else {
          currentY += actualHeight + 4;
        }
      } else if (hasWarnings) {
        // Only warnings, center it or use full width
        const warningsText = p.warnings.trim();
        const wrappedWarn = doc.splitTextToSize(warningsText, 180);
        const warnHeight = wrappedWarn.length * 4 + 10;

        // Draw rounded rectangle for warnings (full width)
        doc.setFillColor(254, 242, 242); // light red background
        doc.setDrawColor(220, 38, 38); // red border
        doc.setLineWidth(0.3);
        doc.roundedRect(14, currentY, 180, warnHeight, 2, 2, "FD");

        // Warnings label
        doc.setFontSize(9);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(153, 27, 27); // red-800
        doc.text("Warnings", 18, currentY + 6);

        // Warnings text
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(127, 29, 29); // red-900
        doc.text(wrappedWarn, 18, currentY + 12);

        currentY += warnHeight + 4;
      }
    }
  });

  // Footer
  const pageHeight = doc.internal.pageSize.height;
  if (currentY + 20 > pageHeight - 10) {
    doc.addPage();
    currentY = pageHeight - 20;
  }
  
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.setFont("helvetica", "italic");
  doc.text(
    "This prescription was generated by MediVoice. Always follow your clinician's instructions.",
    14,
    pageHeight - 10
  );

  const safeName = (patient.name || "Patient").replace(/\s+/g, "_");
  const datePart = new Date().toISOString().slice(0, 10);
  const fileName = `Prescription_${safeName}_${datePart}.pdf`;
  doc.save(fileName);
}


