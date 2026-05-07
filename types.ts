export interface BodyAnalysis {
  heightEstimate: string;
  shoulderWidth: string;
  bodyShape: string;
  suggestedSize: string;
  styleAdvice: string;
}

export interface BodyMeasurements {
  name?: string;
  height?: string; // cm
  weight?: string; // kg
  shoulderWidth?: string; // cm
  chest?: string;
  waist?: string;
  hip?: string;
  armLength?: string;
  legLength?: string;
}

export interface ClothingMeasurements {
  totalLength?: string;
  shoulderWidth?: string;
  chestWidth?: string;
  sleeveLength?: string;
}

export interface ClothingItem {
  id: string;
  name: string;
  category: string;
  price?: string; // Added price field
  description: string; // The prompt sent to Gemini
  image: string; // Placeholder or uploaded image URL
  isCustom?: boolean; // Flag to indicate if this is a user-uploaded clothing item
  measurements?: ClothingMeasurements; // Optional custom measurements
}

export enum AppState {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING',
  SHOPPING = 'SHOPPING',
  GENERATING_TRYON = 'GENERATING_TRYON',
  RESULT = 'RESULT',
}