import { OpenRouter } from '@openrouter/sdk';

let openRouterClient: OpenRouter | null = null;

function getOpenRouter(): OpenRouter {
  if (!openRouterClient) {
    const apiKey = process.env.OPENROUTER_API_KEY || '';
    openRouterClient = new OpenRouter({
      apiKey
    });
  }
  return openRouterClient;
}

// OpenRouter accepts a maximum of 3 models per request in the native `models` fallback array.
export const PRIMARY_MODELS = [
  'dots-studio/dots-3-note-preview:free',
  'nvidia/nemotron-3.5-lightning:free',
  'poolside/laguna-s-2.1:free'
];

export const SECONDARY_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'
];

export const MODEL_TIERS = [
  PRIMARY_MODELS,
  SECONDARY_MODELS
];

function isFatalClientError(status?: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

function extractTextContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return part.text;
        return '';
      })
      .join('');
  }
  return '';
}

function parseAndValidatePreVisit(rawText: string): {
  urgency: 'Low' | 'Medium' | 'High';
  chiefComplaint: string;
  questions: string[];
} {
  let cleaned = rawText.trim();
  // Strip markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  let json: any;
  try {
    json = JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      json = JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
    } else {
      throw new Error('Failed to parse valid JSON from OpenRouter pre-visit response');
    }
  }

  // Validate and normalize urgency to 'Low' | 'Medium' | 'High'
  let urgency: 'Low' | 'Medium' | 'High' = 'Medium';
  const uStr = String(json.urgency || '').toLowerCase();
  if (uStr.includes('high')) urgency = 'High';
  else if (uStr.includes('low')) urgency = 'Low';
  else urgency = 'Medium';

  // Validate chief complaint
  let chiefComplaint = typeof json.chiefComplaint === 'string' ? json.chiefComplaint.trim() : '';
  if (!chiefComplaint) {
    chiefComplaint = 'Patient reported symptoms requiring clinical evaluation';
  }

  // Validate exactly 3 questions
  let rawQuestions = json.questions;
  let questions: string[] = [];
  if (Array.isArray(rawQuestions)) {
    questions = rawQuestions
      .map((q: any) => (typeof q === 'string' ? q.trim() : ''))
      .filter((q: string) => q.length > 0);
  }

  const defaultQuestions = [
    'What is the onset, duration, and progression of your symptoms?',
    'Are you experiencing any other associated symptoms or red flags?',
    'What medications or treatments have you tried so far?'
  ];

  if (questions.length === 0) {
    questions = defaultQuestions;
  } else if (questions.length < 3) {
    while (questions.length < 3) {
      questions.push(defaultQuestions[questions.length]);
    }
  } else if (questions.length > 3) {
    questions = questions.slice(0, 3);
  }

  return {
    urgency,
    chiefComplaint,
    questions
  };
}

export async function generatePreVisitSummary(symptoms: string): Promise<{
  urgency: 'Low' | 'Medium' | 'High';
  chiefComplaint: string;
  questions: string[];
}> {
  const openrouter = getOpenRouter();
  const prompt = `Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: ${symptoms}`;

  let lastError: any = null;

  for (let tierIdx = 0; tierIdx < MODEL_TIERS.length; tierIdx++) {
    const tierModels = MODEL_TIERS[tierIdx];
    const tierName = tierIdx === 0 ? 'Primary' : 'Secondary';

    try {
      const response = await openrouter.chat.send({
        chatRequest: {
          model: tierModels[0],
          models: tierModels,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          responseFormat: {
            type: 'json_object'
          },
          stream: false
        }
      });

      const answeredModel = (response as any).model || tierModels[0];
      console.log(`[OpenRouter Pre-Visit] Success (${tierName} tier). Responded model: ${answeredModel}`);

      const rawContent = (response as any).choices?.[0]?.message?.content;
      const text = extractTextContent(rawContent);

      if (!text) {
        throw new Error('Empty response received from OpenRouter');
      }

      return parseAndValidatePreVisit(text);
    } catch (e: any) {
      lastError = e;
      const status = e.statusCode || e.status || (e.response ? e.response.status : undefined);
      console.error(`[OpenRouter Pre-Visit] ${tierName} tier failed: ${e.message || e} (Status: ${status || 'N/A'})`);

      if (isFatalClientError(status)) {
        throw new Error(`OpenRouter pre-visit generation failed (${status}): ${e.message || e}`);
      }

      if (tierIdx < MODEL_TIERS.length - 1) {
        console.log('[OpenRouter Pre-Visit] Falling back to secondary model tier...');
      }
    }
  }

  throw new Error(`OpenRouter pre-visit generation failed: ${lastError?.message || lastError}`);
}

export async function generatePostVisitSummary(
  notes: string,
  prescription?: string,
  followUpInstructions?: string
): Promise<string> {
  const openrouter = getOpenRouter();
  let context = `Clinical Notes:\n${notes}`;
  if (prescription) {
    context += `\n\nPrescription:\n${prescription}`;
  }
  if (followUpInstructions) {
    context += `\n\nFollow-up Instructions:\n${followUpInstructions}`;
  }
  const prompt = `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: ${context}`;

  let lastError: any = null;

  for (let tierIdx = 0; tierIdx < MODEL_TIERS.length; tierIdx++) {
    const tierModels = MODEL_TIERS[tierIdx];
    const tierName = tierIdx === 0 ? 'Primary' : 'Secondary';

    try {
      const response = await openrouter.chat.send({
        chatRequest: {
          model: tierModels[0],
          models: tierModels,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          stream: false
        }
      });

      const answeredModel = (response as any).model || tierModels[0];
      console.log(`[OpenRouter Post-Visit] Success (${tierName} tier). Responded model: ${answeredModel}`);

      const rawContent = (response as any).choices?.[0]?.message?.content;
      const text = extractTextContent(rawContent);

      if (!text || !text.trim()) {
        throw new Error('Empty post-visit summary received from OpenRouter');
      }

      return text.trim();
    } catch (e: any) {
      lastError = e;
      const status = e.statusCode || e.status || (e.response ? e.response.status : undefined);
      console.error(`[OpenRouter Post-Visit] ${tierName} tier failed: ${e.message || e} (Status: ${status || 'N/A'})`);

      if (isFatalClientError(status)) {
        throw new Error(`OpenRouter post-visit generation failed (${status}): ${e.message || e}`);
      }

      if (tierIdx < MODEL_TIERS.length - 1) {
        console.log('[OpenRouter Post-Visit] Falling back to secondary model tier...');
      }
    }
  }

  throw new Error(`OpenRouter post-visit generation failed: ${lastError?.message || lastError}`);
}
