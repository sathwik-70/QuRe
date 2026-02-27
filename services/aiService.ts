import { GeminiResponse } from "../types";

export const chatWithConcierge = async (
  message: string,
  recordsContext: string[],
  history: any[]
): Promise<GeminiResponse> => {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      console.warn("Configuration Warning: OPENROUTER_API_KEY is missing. AI features will be disabled.");
      return {
        text: "I'm currently unable to connect to the AI network. Please contact the administrator to configure the Neural API Key."
      };
    }

    const safeContext = recordsContext.slice(0, 50).join(', ');
    const context = recordsContext.length > 0
      ? `Patient has the following records in their QuRe vault: ${safeContext}.`
      : `Patient has no bridged records yet.`;

    const instructions = `You are the QuRe Health Concierge, an AI assistant for a decentralized health platform.
        CONTEXT:
        ${context}
        PROTOCOL:
        1. Tone: Professional, empathetic, concise, and clinically responsible.
        2. Scope: Answer questions based on the provided record titles or general medical knowledge.
        3. Safety: NEVER provide a specific medical diagnosis. ALWAYS advise consulting a human doctor.
        4. Privacy: Do not ask for PII (Personally Identifiable Information).`;

    // Map the history array to the OpenRouter format
    const mappedHistory = history.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.parts ? msg.parts[0].text : msg.text || ''
    }));

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": window.location.origin,
        "X-Title": "QuRe Sovereign Health",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: instructions },
          ...mappedHistory,
          { role: "user", content: message }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "I processed the request but received no output.";

    return { text, sources: [] }; // The sources array is no longer natively provided by OpenRouter like it was for Gemini with Google Search
  } catch (error: any) {
    console.error("OpenRouter Protocol Error:", error);
    if (error.message?.includes('403') || error.message?.includes('401')) return { text: "Access Forbidden. Please check API Key permissions." };
    if (error.message?.includes('429')) return { text: "High traffic volume. Please try again in a moment." };
    return { text: "Protocol connection interrupted. The neural node is currently unreachable." };
  }
};