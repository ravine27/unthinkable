/**
 * Deterministic Prescription Parser for MediFlow
 * Extracts medication name, dosage, frequency, duration, and instructions without making assumptions.
 */

export interface ParsedMedication {
  medicationName: string;
  dosage?: string;
  frequency: string;
  instructions?: string;
  reminderTimes: string[]; // e.g. ["09:00", "21:00"]
  durationDays: number;
}

// Standard time mappings for common medical frequencies
export const FREQUENCY_SCHEDULE_MAP: Record<string, { frequency: string; times: string[] }> = {
  'once_daily': { frequency: 'Once daily', times: ['09:00'] },
  'twice_daily': { frequency: 'Twice daily', times: ['09:00', '21:00'] },
  'three_times_daily': { frequency: 'Three times daily', times: ['08:00', '14:00', '20:00'] },
  'four_times_daily': { frequency: 'Four times daily', times: ['08:00', '12:00', '16:00', '20:00'] },
  'every_4_hours': { frequency: 'Every 4 hours', times: ['04:00', '08:00', '12:00', '16:00', '20:00', '00:00'] },
  'every_6_hours': { frequency: 'Every 6 hours', times: ['06:00', '12:00', '18:00', '00:00'] },
  'every_8_hours': { frequency: 'Every 8 hours', times: ['08:00', '16:00', '00:00'] },
  'every_12_hours': { frequency: 'Every 12 hours', times: ['08:00', '20:00'] },
  'every_24_hours': { frequency: 'Every 24 hours', times: ['09:00'] },
  'morning': { frequency: 'Once daily (Morning)', times: ['08:00'] },
  'night': { frequency: 'Once daily (Night)', times: ['21:00'] },
  'as_needed': { frequency: 'As needed (PRN)', times: [] },
};

/**
 * Identify frequency and corresponding reminder times deterministically from prescription text.
 */
export function matchFrequency(text: string): { frequency: string; times: string[] } | null {
  const lower = text.toLowerCase();

  if (/\b(as needed|prn|when required|as required)\b/i.test(lower)) {
    return FREQUENCY_SCHEDULE_MAP['as_needed'];
  }
  if (/\b(every\s*4\s*hours?|q4h)\b/i.test(lower)) {
    return FREQUENCY_SCHEDULE_MAP['every_4_hours'];
  }
  if (/\b(every\s*6\s*hours?|q6h)\b/i.test(lower)) {
    return FREQUENCY_SCHEDULE_MAP['every_6_hours'];
  }
  if (/\b(every\s*8\s*hours?|q8h)\b/i.test(lower)) {
    return FREQUENCY_SCHEDULE_MAP['every_8_hours'];
  }
  if (/\b(every\s*12\s*hours?|q12h)\b/i.test(lower)) {
    return FREQUENCY_SCHEDULE_MAP['every_12_hours'];
  }
  if (/\b(four\s*times\s*a?\s*daily|four\s*times\s*a?\s*day|4\s*times\s*a?\s*daily|4\s*times\s*a?\s*day|4x\s*daily|qid|qds)\b/i.test(lower)) {
    return FREQUENCY_SCHEDULE_MAP['four_times_daily'];
  }
  if (/\b(three\s*times\s*a?\s*daily|three\s*times\s*a?\s*day|3\s*times\s*a?\s*daily|3\s*times\s*a?\s*day|3x\s*daily|tid|tds|thrice\s*daily|thrice\s*a?\s*day)\b/i.test(lower)) {
    return FREQUENCY_SCHEDULE_MAP['three_times_daily'];
  }
  if (/\b(twice\s*daily|twice\s*a?\s*day|two\s*times\s*a?\s*daily|two\s*times\s*a?\s*day|2\s*times\s*a?\s*daily|2\s*times\s*a?\s*day|2x\s*daily|bid|bd)\b/i.test(lower)) {
    return FREQUENCY_SCHEDULE_MAP['twice_daily'];
  }
  if (/\b(at\s*night|before\s*bed|bedtime|at\s*bedtime|qhs)\b/i.test(lower)) {
    return FREQUENCY_SCHEDULE_MAP['night'];
  }
  if (/\b(in\s*the\s*morning|every\s*morning|each\s*morning)\b/i.test(lower)) {
    return FREQUENCY_SCHEDULE_MAP['morning'];
  }
  if (/\b(once\s*daily|once\s*a?\s*day|1\s*time\s*a?\s*daily|1\s*time\s*a?\s*day|1x\s*daily|daily|od|qd|every\s*day)\b/i.test(lower)) {
    return FREQUENCY_SCHEDULE_MAP['once_daily'];
  }

  return null;
}

/**
 * Extract duration in days from text (e.g. "for 5 days", "7 days", "2 weeks", "1 month").
 */
export function matchDuration(text: string): number {
  const lower = text.toLowerCase();
  
  const dayMatch = lower.match(/\b(?:for\s*)?(\d+)\s*(?:days?|d)\b/i);
  if (dayMatch) {
    const days = parseInt(dayMatch[1], 10);
    if (!isNaN(days) && days > 0 && days <= 365) return days;
  }

  const weekMatch = lower.match(/\b(?:for\s*)?(\d+)\s*(?:weeks?|wk|wks)\b/i);
  if (weekMatch) {
    const weeks = parseInt(weekMatch[1], 10);
    if (!isNaN(weeks) && weeks > 0 && weeks <= 52) return weeks * 7;
  }

  const monthMatch = lower.match(/\b(?:for\s*)?(\d+)\s*(?:months?|mo|mos)\b/i);
  if (monthMatch) {
    const months = parseInt(monthMatch[1], 10);
    if (!isNaN(months) && months > 0 && months <= 12) return months * 30;
  }

  // Default duration if none is explicitly mentioned
  return 5;
}

/**
 * Extract dosage string (e.g. 650mg, 500 mg, 10ml, 5mg/ml, 1 tablet, 2 puffs, 1 capsule).
 */
export function matchDosage(text: string): string | undefined {
  const match = text.match(/\b(\d+(?:\.\d+)?\s*(?:mg|g|mcg|ml|iu|units?|tablets?|tabs?|capsules?|caps?|puffs?|drops?|sachets?)(?:\/\d+(?:\.\d+)?\s*(?:mg|g|mcg|ml))?)\b/i);
  return match ? match[1].trim() : undefined;
}

/**
 * Extract additional instructions (e.g., "after food", "before meals", "with warm water", "with food").
 */
export function matchInstructions(text: string): string | undefined {
  const lower = text.toLowerCase();
  const patterns = [
    /\b(after\s+(?:food|meals|eating|breakfast|lunch|dinner))\b/i,
    /\b(before\s+(?:food|meals|eating|breakfast|lunch|dinner))\b/i,
    /\b(with\s+(?:food|meals|water|milk|warm\s+water))\b/i,
    /\b(empty\s+stomach|on\s+an\s+empty\s+stomach)\b/i,
    /\b(as\s+directed|as\s+prescribed|with\s+plenty\s+of\s+water)\b/i,
    /\b(take\s+with\s+[a-z\s]+)\b/i,
  ];

  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) return m[1].trim();
  }
  return undefined;
}

/**
 * Cleans a line to isolate medication name.
 */
function cleanMedicationName(raw: string, dosage?: string): string {
  let name = raw
    // Remove list numbering like "1.", "2)", "•", "-"
    .replace(/^[\s\d\-•*.)]+\s*/, '')
    // Remove common phrases and instructions
    .replace(/\b(for\s*\d+\s*(?:days?|weeks?|months?))\b/gi, '')
    .replace(/\b(once|twice|three times|four times|thrice|daily|as needed|prn|bid|tid|qid|od|qd|qds|tds)\b/gi, '')
    .replace(/\b(every\s*\d+\s*hours?)\b/gi, '')
    .replace(/\b(after|before|with)\s+(?:food|meals|water|milk|dinner|lunch|breakfast)\b/gi, '')
    .replace(/\b(empty\s+stomach|on\s+an\s+empty\s+stomach)\b/gi, '')
    .replace(/\b(take|ingest|consume|apply|use|as directed)\b/gi, '')
    .replace(/[–—,-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // If dosage was found, remove it from name if desired or keep clean
  if (dosage) {
    const regex = new RegExp(`\\b${dosage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    name = name.replace(regex, '').trim();
  }

  // Clean trailing punctuation or whitespace
  name = name.replace(/[,;:\-]+$/, '').replace(/\s+/g, ' ').trim();
  return name.length > 0 ? name : raw.trim();
}

/**
 * Parses raw prescription string into structured list of medications.
 */
export function parsePrescription(rawPrescription?: string | null): ParsedMedication[] {
  if (!rawPrescription || !rawPrescription.trim()) {
    return [];
  }

  const results: ParsedMedication[] = [];

  // Split lines on newlines or semicolons or numbered items
  const lines = rawPrescription
    .split(/\r?\n|;/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  for (const line of lines) {
    // If a line contains multiple numbered medications e.g. "1. Med A 2. Med B"
    const subSegments = line.split(/(?=\b\d+[\.)]\s+)/).filter(s => s.trim().length > 0);

    for (const segment of subSegments) {
      const trimmed = segment.trim();
      if (!trimmed || trimmed.length < 2) continue;

      const freqMatch = matchFrequency(trimmed);
      const dosage = matchDosage(trimmed);
      const instructions = matchInstructions(trimmed);
      const durationDays = matchDuration(trimmed);
      const name = cleanMedicationName(trimmed, dosage);

      if (!name || name.length < 2) continue;

      // If frequency is not matched, check if it's at least a recognized medication entry
      // If no frequency is provided at all, we log/record without guessing unsafe times
      const frequency = freqMatch ? freqMatch.frequency : 'As prescribed';
      const reminderTimes = freqMatch ? freqMatch.times : [];

      // Store only the clean drug name (not combined with dosage).
      // The dosage field is already stored separately; combining them
      // caused redundant display like "Paracetamol 650mg (650mg)".
      results.push({
        medicationName: name,
        dosage: dosage || undefined,
        frequency,
        instructions: instructions || undefined,
        reminderTimes,
        durationDays,
      });
    }
  }

  return results;
}
