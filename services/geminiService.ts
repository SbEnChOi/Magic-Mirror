import { GoogleGenAI, Type } from "@google/genai";
import { BodyAnalysis, BodyMeasurements, ClothingMeasurements } from "../types";

// Ensure API Key is available
const apiKey = process.env.API_KEY || '';

const ai = new GoogleGenAI({ apiKey });

/**
 * Analyzes a body image to estimate measurements and shape.
 */
export const analyzeBodyImage = async (base64Image: string): Promise<BodyAnalysis> => {
  if (!apiKey) throw new Error("API Key is missing");

  // Remove data URL prefix if present for processing
  const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|webp);base64,/, "");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: cleanBase64,
            },
          },
          {
            text: `Analyze this person's body structure for a clothing try-on application. 
                   Estimate relative proportions. Be polite and professional.
                   Provide the output strictly in JSON format.`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            heightEstimate: { type: Type.STRING, description: "Estimated height description (e.g., 'Tall', 'Average')" },
            shoulderWidth: { type: Type.STRING, description: "Description of shoulder width" },
            bodyShape: { type: Type.STRING, description: "General body shape description (e.g., 'Athletic', 'Slim', 'Curvy')" },
            suggestedSize: { type: Type.STRING, description: "Suggested clothing size (S, M, L, XL)" },
            styleAdvice: { type: Type.STRING, description: "One sentence fashion advice based on body shape" },
          },
          required: ["heightEstimate", "shoulderWidth", "bodyShape", "suggestedSize", "styleAdvice"],
        },
      },
    });

    const text = response.text;
    if (!text) throw new Error("No response from AI");
    
    return JSON.parse(text) as BodyAnalysis;
  } catch (error) {
    console.error("Analysis failed:", error);
    throw error;
  }
};

/**
 * Generates a "Virtual Try-On" image.
 * Uses the image model to modify the user's clothes.
 * Now incorporates detailed measurements if provided.
 */
export const generateTryOnImage = async (
  personImageBase64: string, 
  clothingDescription: string,
  clothingImageBase64?: string,
  size: string = 'M',
  bodyMeasurements?: BodyMeasurements,
  clothingMeasurements?: ClothingMeasurements,
  clothingName?: string
): Promise<string> => {
  if (!apiKey) throw new Error("API Key is missing");

  const cleanPersonBase64 = personImageBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");

  // Construct fit description based on size
  let fitInstruction = "";
  switch (size) {
    case 'S': fitInstruction = "The fit should be tight and form-fitting, corresponding to a Small size."; break;
    case 'M': fitInstruction = "The fit should be regular and standard, corresponding to a Medium size."; break;
    case 'L': fitInstruction = "The fit should be relaxed and slightly loose, corresponding to a Large size."; break;
    case 'XL': fitInstruction = "The fit should be loose, baggy, and oversized, corresponding to an Extra Large size."; break;
    default: fitInstruction = "The fit should be standard."; break;
  }

  // Inject Body Measurements into prompt if available
  let bodyContext = "";
  if (bodyMeasurements) {
    const details = [];
    if (bodyMeasurements.height) details.push(`Height: ${bodyMeasurements.height}cm`);
    if (bodyMeasurements.weight) details.push(`Weight: ${bodyMeasurements.weight}kg`);
    if (bodyMeasurements.shoulderWidth) details.push(`Shoulder Width: ${bodyMeasurements.shoulderWidth}cm`);
    if (bodyMeasurements.chest) details.push(`Chest Circumference: ${bodyMeasurements.chest}cm`);
    if (bodyMeasurements.waist) details.push(`Waist: ${bodyMeasurements.waist}cm`);
    if (bodyMeasurements.hip) details.push(`Hip: ${bodyMeasurements.hip}cm`);
    if (bodyMeasurements.armLength) details.push(`Arm Length: ${bodyMeasurements.armLength}cm`);
    if (bodyMeasurements.legLength) details.push(`Leg Length: ${bodyMeasurements.legLength}cm`);
    
    if (details.length > 0) {
      bodyContext = ` The person has the following specific measurements: ${details.join(', ')}. Please respect these proportions accurately.`;
    }
  }

  // Inject Clothing Measurements into prompt if available
  let clothingContext = "";
  if (clothingMeasurements) {
    const cDetails = [];
    if (clothingMeasurements.totalLength) cDetails.push(`Total Length: ${clothingMeasurements.totalLength}cm`);
    if (clothingMeasurements.chestWidth) cDetails.push(`Chest Width: ${clothingMeasurements.chestWidth}cm`);
    if (clothingMeasurements.shoulderWidth) cDetails.push(`Shoulder Width: ${clothingMeasurements.shoulderWidth}cm`);
    if (clothingMeasurements.sleeveLength) cDetails.push(`Sleeve Length: ${clothingMeasurements.sleeveLength}cm`);

    if (cDetails.length > 0) {
      clothingContext = ` The clothing item has these specific dimensions: ${cDetails.join(', ')}. Adjust the drape and fit on the body to match these real-world dimensions.`;
    }
  }

  // Enhance description with Name if available
  const enhancedDescription = clothingName 
    ? `Item Name: "${clothingName}". ${clothingDescription}` 
    : clothingDescription;

  try {
    const parts: any[] = [
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: cleanPersonBase64,
        },
      }
    ];

    // If we have a custom clothing image, add it to the prompt parts
    if (clothingImageBase64) {
      const cleanClothingBase64 = clothingImageBase64.replace(/^data:image\/(png|jpeg|webp);base64,/, "");
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: cleanClothingBase64,
        },
      });
      parts.push({
        text: `Using the second image (clothing) as a reference, dress the person in the first image with this item.
               Item Description: ${enhancedDescription}.
               Maintain the person's exact face, identity, pose, and background. 
               ${fitInstruction}
               ${bodyContext}
               ${clothingContext}
               Make it look photorealistic.`,
      });
    } else {
      // Standard Text-based Try On
      parts.push({
        text: `Replace the person's current outfit with: ${enhancedDescription}. 
               Maintain the person's exact face, identity, pose, and background. 
               ${fitInstruction}
               ${bodyContext}
               Make it look photorealistic. High fashion photography style.`,
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image", 
      contents: {
        parts: parts,
      },
    });

    // Extract image from response
    if (response.candidates && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }
    
    throw new Error("No image generated.");

  } catch (error) {
    console.error("Try-on generation failed:", error);
    throw error;
  }
};