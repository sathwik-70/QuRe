import { GoogleGenAI } from "@google/genai";
import { GeminiResponse } from "../types";

export const chatWithConcierge = async (
  message: string, 
  recordsContext: string[], 
  history: any[]
): Promise<GeminiResponse> => {
  try {
    // Production Grade: Securely access API Key from process.env
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
      console.warn("Configuration Warning: GEMINI_API_KEY is missing. AI features will be disabled.");
      return { 
        text: "I'm currently unable to connect to the AI network. Please contact the administrator to configure the Neural API Key." 
      };
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // Construct context from user's medical records
    // Sanitize context to prevent potential injection or token overflow
    const safeContext = recordsContext.slice(0, 50).join(', '); // Limit to latest 50 record titles
    
    const context = recordsContext.length > 0 
      ? `Patient has the following records in their QuRe vault: ${safeContext}.`
      : `Patient has no bridged records yet.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [
        ...history,
        { role: 'user', parts: [{ text: message }] }
      ],
      config: {
        systemInstruction: `You are the QuRe Health Concierge, an AI assistant for a decentralized health platform.
        
        CONTEXT:
        ${context}
        
        PROTOCOL:
        1. Tone: Professional, empathetic, concise, and clinically responsible.
        2. Scope: Answer questions based on the provided record titles or general medical knowledge.
        3. Safety: NEVER provide a specific medical diagnosis. ALWAYS advise consulting a human doctor.
        4. Privacy: Do not ask for PII (Personally Identifiable Information).
        
        CAPABILITIES:
        - You can use Google Search to find current medical guidelines, drug interactions, or news.
        `,
        tools: [{ googleSearch: {} }]
      }
    });

    const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
      ?.map((c: any) => c.web)
      .filter((w: any) => w && w.uri)
      .map((w: any) => ({ title: w.title, uri: w.uri })) || [];

    return { text: response.text || "I processed the request but received no output.", sources };
  } catch (error: any) {
    console.error("Gemini Protocol Error:", error);
    
    // Friendly error mapping
    if (error.message?.includes('403')) return { text: "Access Forbidden. Please check API Key permissions." };
    if (error.message?.includes('429')) return { text: "High traffic volume. Please try again in a moment." };
    
    return { text: "Protocol connection interrupted. The neural node is currently unreachable." };
  }
};