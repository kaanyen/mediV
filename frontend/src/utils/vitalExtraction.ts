/**
 * Fast client-side vital sign extraction using regex patterns
 * This provides instant feedback for common patterns, with MedGemma as fallback for complex cases
 */

export type ExtractedVitals = {
  bp: string | null;
  temp: string | null;
  pulse: string | null;
  spo2: string | null;
};

/**
 * Extract vital signs from text using regex patterns
 * Handles common formats like "140/90", "38 degrees", "pulse 72", etc.
 */
export function extractVitalsFast(text: string): ExtractedVitals {
  const normalized = text.toLowerCase().replace(/[^\w\s\/\d\.]/g, " ");
  const words = normalized.split(/\s+/);

  const result: ExtractedVitals = {
    bp: null,
    temp: null,
    pulse: null,
    spo2: null,
  };

  // Blood Pressure patterns: "140/90", "bp 140 over 90", "pressure 140/90", "systolic 140 diastolic 90"
  const bpPatterns = [
    /\b(\d{2,3})\s*\/\s*(\d{2,3})\b.*?(?:bp|blood\s*pressure|pressure)/i,
    /\b(?:bp|blood\s*pressure|pressure).*?(\d{2,3})\s*(?:over|\/)\s*(\d{2,3})\b/i,
    /\b(?:systolic|sys)\s*(\d{2,3}).*?(?:diastolic|dias)\s*(\d{2,3})\b/i,
    /\b(\d{2,3})\s*over\s*(\d{2,3})\b/i,
  ];

  for (const pattern of bpPatterns) {
    const match = text.match(pattern);
    if (match) {
      const sys = match[1] || match[2];
      const dia = match[2] || match[3] || match[4];
      if (sys && dia && parseInt(sys) >= 80 && parseInt(sys) <= 250 && parseInt(dia) >= 40 && parseInt(dia) <= 150) {
        result.bp = `${sys}/${dia}`;
        break;
      }
    }
  }

  // Temperature patterns: "38 degrees", "temp 38", "temperature 38.5", "38°C", "fever 38"
  const tempPatterns = [
    /\b(?:temp|temperature|fever|febrile).*?(\d{2}(?:\.\d+)?)\s*(?:degrees?|°|celsius|celcius|°c)\b/i,
    /\b(\d{2}(?:\.\d+)?)\s*(?:degrees?|°)\s*(?:celsius|celcius|c|temp|temperature)\b/i,
    /\b(?:temp|temperature)\s*:?\s*(\d{2}(?:\.\d+)?)\b/i,
  ];

  for (const pattern of tempPatterns) {
    const match = text.match(pattern);
    if (match) {
      const temp = match[1];
      if (temp && parseFloat(temp) >= 30 && parseFloat(temp) <= 45) {
        result.temp = temp;
        break;
      }
    }
  }

  // Pulse/Heart Rate patterns: "pulse 72", "hr 80", "heart rate 90", "bpm 75"
  const pulsePatterns = [
    /\b(?:pulse|hr|heart\s*rate|bpm).*?(\d{2,3})\s*(?:bpm|beats?)?\b/i,
    /\b(\d{2,3})\s*(?:bpm|beats?\s*per\s*minute)\b/i,
  ];

  for (const pattern of pulsePatterns) {
    const match = text.match(pattern);
    if (match) {
      const pulse = match[1];
      if (pulse && parseInt(pulse) >= 40 && parseInt(pulse) <= 200) {
        result.pulse = pulse;
        break;
      }
    }
  }

  // SpO2 patterns: "spo2 98", "oxygen 95", "o2 sat 97", "saturation 96%"
  const spo2Patterns = [
    /\b(?:spo2|sp\s*o2|oxygen\s*saturation|o2\s*sat|saturation).*?(\d{2,3})\s*%?\b/i,
    /\b(\d{2,3})\s*%\s*(?:oxygen|o2|spo2|saturation)\b/i,
  ];

  for (const pattern of spo2Patterns) {
    const match = text.match(pattern);
    if (match) {
      const spo2 = match[1];
      if (spo2 && parseInt(spo2) >= 70 && parseInt(spo2) <= 100) {
        result.spo2 = spo2;
        break;
      }
    }
  }

  return result;
}

/**
 * Check if fast extraction found any vitals
 */
export function hasVitals(extracted: ExtractedVitals): boolean {
  return Boolean(extracted.bp || extracted.temp || extracted.pulse || extracted.spo2);
}

