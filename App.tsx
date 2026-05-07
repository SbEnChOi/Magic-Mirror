import React, { useState, useRef } from 'react';
import { Camera, RefreshCw, Shirt, ChevronRight, Activity, ShoppingBag, X, Upload, Image as ImageIcon, Plus, Download, AlertCircle, Ruler, ChevronLeft, Save, Tag, ChevronDown, ChevronUp, Edit2 } from 'lucide-react';
import CameraFeed, { CameraFeedHandle } from './components/CameraFeed';
import { analyzeBodyImage, generateTryOnImage } from './services/geminiService';
import { CLOTHING_CATALOG } from './constants';
import { BodyAnalysis, AppState, ClothingItem, BodyMeasurements, ClothingMeasurements } from './types';

const AVAILABLE_SIZES = ['S', 'M', 'L', 'XL'];

// --- Components (Defined outside to prevent re-render focus loss) ---

const InputField = ({ label, value, onChange, placeholder, type = "text" }: { label: string, value?: string, onChange: (v: string) => void, placeholder: string, type?: string }) => (
  <div className="flex flex-col gap-1">
    <label className="text-xs uppercase text-white/60 tracking-wider">{label}</label>
    <input 
      type={type}
      value={value || ''} 
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-400 focus:bg-white/10 transition-all placeholder:text-white/20 w-full"
    />
  </div>
);

function App() {
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [analysis, setAnalysis] = useState<BodyAnalysis | null>(null);
  
  // Data State
  const [userSnapshot, setUserSnapshot] = useState<string | null>(null);
  const [userMeasurements, setUserMeasurements] = useState<BodyMeasurements | undefined>(undefined);
  const [selectedClothing, setSelectedClothing] = useState<ClothingItem | null>(null);
  const [selectedSize, setSelectedSize] = useState<string>('M'); 
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [uploadedClothing, setUploadedClothing] = useState<ClothingItem[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Modal State
  const [showBodyModal, setShowBodyModal] = useState(false);
  const [showClothingModal, setShowClothingModal] = useState(false);
  const [tempImage, setTempImage] = useState<string | null>(null);
  
  // Form State
  const [tempBodyData, setTempBodyData] = useState<BodyMeasurements>({});
  const [expandBodyMeasurements, setExpandBodyMeasurements] = useState(false); // New state for collapsing measurements
  
  // Clothing Form State
  const [tempClothingMeasurements, setTempClothingMeasurements] = useState<ClothingMeasurements>({});
  const [tempClothingInfo, setTempClothingInfo] = useState<{name: string, price: string}>({ name: '', price: '' });

  
  const cameraRef = useRef<CameraFeedHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const clothingInputRef = useRef<HTMLInputElement>(null);

  // --- Utilities ---

  const standardizeImage = (base64Str: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const targetWidth = 1080;
        const targetHeight = 1920;
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(base64Str); return; }
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        const scale = Math.min(targetWidth / img.width, targetHeight / img.height);
        const x = (targetWidth / 2) - (img.width / 2) * scale;
        const y = (targetHeight / 2) - (img.height / 2) * scale;
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.src = base64Str;
    });
  };

  // --- Handlers ---

  const handleError = (error: any) => {
    console.error(error);
    setErrorMsg("Connection interrupted. Please ensure API Key is valid and try again.");
    if (appState === AppState.GENERATING_TRYON) {
      setAppState(AppState.SHOPPING);
    } else {
      setAppState(AppState.IDLE);
    }
    setTimeout(() => setErrorMsg(null), 5000);
  };

  const handleScanBody = async () => {
    if (!cameraRef.current) return;
    cameraRef.current.triggerPoseSuccess();
    setTimeout(async () => {
        const snapshot = cameraRef.current?.captureFrame();
        if (!snapshot) return;
        await processUserImage(snapshot);
    }, 600);
  };

  // 1. Open Body Modal (User clicks "Upload Photo")
  const openBodyModal = () => {
    setTempImage(null);
    setTempBodyData({});
    setExpandBodyMeasurements(false); // Default to collapsed
    setShowBodyModal(true);
  };

  // 1.5 Open Body Modal for EDITING (User clicks Metrics Panel)
  const openEditBodyMetrics = () => {
    setTempBodyData(userMeasurements || {});
    // If we are editing, we don't need to select an image, so we keep tempImage null
    // But to satisfy the "disabled" check on the button, we might need logic.
    // Actually, logic below handles "if editing, ignore tempImage requirement"
    setExpandBodyMeasurements(true); // Always expand for editing
    setShowBodyModal(true);
  };

  // 2. Handle File Selection for Body
  const handleBodyFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const rawBase64 = reader.result as string;
        const standardized = await standardizeImage(rawBase64);
        setTempImage(standardized);
      };
      reader.readAsDataURL(file);
    }
    // Reset input so same file can be selected again
    event.target.value = '';
  };

  // 3. Confirm Body Upload (Or Edit Update)
  const confirmBodyUpload = async () => {
    // Mode A: Editing existing scan
    if (userSnapshot && appState !== AppState.IDLE) {
       setUserMeasurements(tempBodyData);
       setShowBodyModal(false);
       return;
    }

    // Mode B: New Upload
    if (tempImage) {
      setShowBodyModal(false);
      setUserMeasurements(tempBodyData);
      await processUserImage(tempImage);
      setTempImage(null);
    }
  };

  const processUserImage = async (imageSrc: string) => {
    setUserSnapshot(imageSrc);
    setAppState(AppState.ANALYZING);
    try {
        const result = await analyzeBodyImage(imageSrc);
        setAnalysis(result);
        setAppState(AppState.SHOPPING);
      } catch (err) {
        handleError(err);
      }
  }

  // 1. Open Clothing Modal (User clicks "+")
  const openClothingModal = () => {
    setTempImage(null);
    setTempClothingMeasurements({});
    setTempClothingInfo({ name: '', price: '' });
    setShowClothingModal(true);
  };

  // 2. Handle File Selection for Clothing
  const handleClothingFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setTempImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
    event.target.value = '';
  };

  // 3. Confirm Clothing Modal
  const confirmClothingUpload = () => {
    if (tempImage) {
      const newItem: ClothingItem = {
        id: `custom-${Date.now()}`,
        name: tempClothingInfo.name || 'Custom Piece',
        price: tempClothingInfo.price,
        category: 'Uploaded',
        description: 'A custom uploaded clothing item',
        image: tempImage,
        isCustom: true,
        measurements: tempClothingMeasurements 
      };
      setUploadedClothing(prev => [newItem, ...prev]);
      setSelectedClothing(newItem);
      setShowClothingModal(false);
      setTempImage(null);
    }
  };

  const handleTryOn = async () => {
    if (!selectedClothing || !userSnapshot) return;

    setAppState(AppState.GENERATING_TRYON);
    
    try {
      const customImage = selectedClothing.isCustom ? selectedClothing.image : undefined;
      const resultImage = await generateTryOnImage(
        userSnapshot, 
        selectedClothing.description,
        customImage,
        selectedSize,
        userMeasurements, // Pass user body data
        selectedClothing.measurements, // Pass clothing data
        selectedClothing.name // Pass clothing name for context
      );
      setGeneratedImage(resultImage);
      setAppState(AppState.RESULT);
    } catch (err) {
      handleError(err);
    }
  };

  const handleBackToScan = () => {
    setAppState(AppState.IDLE);
    setAnalysis(null);
    setUserSnapshot(null);
    setSelectedClothing(null);
    setUserMeasurements(undefined);
  };

  const handleDownload = () => {
    if (generatedImage) {
      const link = document.createElement('a');
      link.href = generatedImage;
      link.download = `magic-mirror-tryon-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const resetProcess = () => {
    handleBackToScan();
    setGeneratedImage(null);
    setUploadedClothing([]);
    setSelectedSize('M');
  };

  const fullCatalog = [...uploadedClothing, ...CLOTHING_CATALOG];

  const isEditingMetrics = !!(userSnapshot && appState !== AppState.IDLE);

  return (
    <div className="relative w-screen h-screen overflow-hidden font-sans selection:bg-pink-500/30">
      
      {/* Hidden Inputs triggered by buttons inside modals */}
      <input type="file" ref={fileInputRef} onChange={handleBodyFileSelect} accept="image/*" className="hidden" />
      <input type="file" ref={clothingInputRef} onChange={handleClothingFileSelect} accept="image/*" className="hidden" />

      {/* Layer 1: Background/Camera */}
      <div className={`absolute inset-0 transition-all duration-700 ${userSnapshot ? 'blur-sm opacity-50' : 'opacity-100'}`}>
         {!userSnapshot ? (
            <CameraFeed isActive={appState === AppState.IDLE || appState === AppState.ANALYZING} ref={cameraRef} />
         ) : (
            <img src={userSnapshot} className="w-full h-full object-contain bg-black" alt="User" />
         )}
      </div>

      {/* MODAL: Body Measurement Upload OR Edit */}
      {showBodyModal && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="glass-card w-full max-w-lg rounded-2xl p-6 md:p-8 flex flex-col gap-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              {isEditingMetrics ? <Edit2 className="w-6 h-6 text-cyan-400" /> : <Upload className="w-6 h-6 text-cyan-400" />}
              {isEditingMetrics ? "Edit Body Metrics" : "Target Setup"}
            </h2>
            
            {/* Image Selection Area - ONLY SHOW IF NOT EDITING */}
            {!isEditingMetrics && (
              <>
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-48 rounded-xl border-2 border-dashed border-white/20 hover:border-cyan-400/50 hover:bg-white/5 transition-all cursor-pointer relative group overflow-hidden bg-black/20 shrink-0"
                >
                  {tempImage ? (
                    <>
                      <img src={tempImage} alt="Preview" className="w-full h-full object-contain" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity">
                        <RefreshCw className="w-8 h-8 text-white mb-2" />
                        <span className="text-white font-bold text-sm">Change Image</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-white/50 group-hover:text-cyan-300 transition-colors">
                      <Plus className="w-10 h-10 mb-3" />
                      <span className="text-sm font-bold uppercase tracking-wider">UPLOAD BODY IMAGE</span>
                      <span className="text-xs opacity-60 mt-1">Click to browse files</span>
                    </div>
                  )}
                </div>
                <div className="h-px bg-white/10 my-1 shrink-0" />
              </>
            )}
            
            {/* Collapsible Measurements Section */}
            {/* If editing, don't show the collapse toggle, just show the form, or force expanded */}
            <button 
              onClick={() => setExpandBodyMeasurements(!expandBodyMeasurements)}
              className="flex items-center justify-between w-full py-2 hover:text-cyan-400 transition-colors group shrink-0"
            >
                <div className="flex flex-col items-start">
                    <h3 className="text-sm uppercase tracking-widest text-white/80 font-bold group-hover:text-cyan-400">Measurements {isEditingMetrics ? "" : "(Optional)"}</h3>
                    {!expandBodyMeasurements && !isEditingMetrics && <span className="text-xs text-white/40">Click to add detailed sizing</span>}
                </div>
                {expandBodyMeasurements ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>

            {expandBodyMeasurements && (
                <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                    <InputField label="Name" value={tempBodyData.name} onChange={(v) => setTempBodyData(prev => ({...prev, name: v}))} placeholder="User Name" />
                    <InputField label="Height (cm)" value={tempBodyData.height} onChange={(v) => setTempBodyData(prev => ({...prev, height: v}))} placeholder="e.g. 175" />
                    <InputField label="Weight (kg)" value={tempBodyData.weight} onChange={(v) => setTempBodyData(prev => ({...prev, weight: v}))} placeholder="e.g. 70" />
                    <InputField label="Shoulder (cm)" value={tempBodyData.shoulderWidth} onChange={(v) => setTempBodyData(prev => ({...prev, shoulderWidth: v}))} placeholder="Width" />
                    <InputField label="Chest (cm)" value={tempBodyData.chest} onChange={(v) => setTempBodyData(prev => ({...prev, chest: v}))} placeholder="Circumference" />
                    <InputField label="Waist (cm)" value={tempBodyData.waist} onChange={(v) => setTempBodyData(prev => ({...prev, waist: v}))} placeholder="Circumference" />
                    <InputField label="Hip (cm)" value={tempBodyData.hip} onChange={(v) => setTempBodyData(prev => ({...prev, hip: v}))} placeholder="Circumference" />
                    <InputField label="Arm Length (cm)" value={tempBodyData.armLength} onChange={(v) => setTempBodyData(prev => ({...prev, armLength: v}))} placeholder="Length" />
                    <InputField label="Leg Length (cm)" value={tempBodyData.legLength} onChange={(v) => setTempBodyData(prev => ({...prev, legLength: v}))} placeholder="Length" />
                </div>
            )}
            
            <div className="flex gap-3 mt-auto pt-2 shrink-0">
              <button onClick={() => { setShowBodyModal(false); setTempImage(null); }} className="flex-1 py-3 rounded-xl border border-white/20 hover:bg-white/10 text-white/70">Cancel</button>
              <button 
                onClick={confirmBodyUpload} 
                disabled={!isEditingMetrics && !tempImage} // If editing, we don't need tempImage
                className={`flex-1 py-3 rounded-xl font-bold shadow-lg transition-all ${
                    (isEditingMetrics || tempImage) 
                        ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white hover:shadow-cyan-500/30' 
                        : 'bg-white/10 text-white/30 cursor-not-allowed'
                }`}
              >
                {isEditingMetrics ? "Update Metrics" : "Start Scan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Clothing Measurement Upload */}
      {showClothingModal && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-200">
          <div className="glass-card w-full max-w-md rounded-2xl p-6 md:p-8 flex flex-col gap-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Shirt className="w-6 h-6 text-purple-400" />
              Add Clothing
            </h2>
            
             {/* Image Selection Area - DESIGN MATCHED TO CLOTHING UPLOAD */}
             <div 
              onClick={() => clothingInputRef.current?.click()}
              className="w-full h-48 rounded-xl border-2 border-dashed border-white/20 hover:border-purple-400/50 hover:bg-white/5 transition-all cursor-pointer relative group overflow-hidden bg-black/20"
            >
              {tempImage ? (
                <>
                  <img src={tempImage} alt="Preview" className="w-full h-full object-contain" />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center transition-opacity">
                    <RefreshCw className="w-8 h-8 text-white mb-2" />
                    <span className="text-white font-bold text-sm">Change Image</span>
                  </div>
                </>
              ) : (
                 <div className="flex flex-col items-center justify-center h-full text-white/50 group-hover:text-purple-300 transition-colors">
                  <Plus className="w-10 h-10 mb-3" />
                  <span className="text-sm font-bold uppercase tracking-wider">UPLOAD ITEM</span>
                  <span className="text-xs opacity-60 mt-1">Click to browse files</span>
                </div>
              )}
            </div>

            {/* Basic Info */}
            <h3 className="text-sm uppercase tracking-widest text-white/80 font-bold border-b border-white/10 pb-1">Basic Info</h3>
            <div className="grid grid-cols-2 gap-4">
                 <InputField label="Item Name" value={tempClothingInfo.name} onChange={(v) => setTempClothingInfo(p => ({...p, name: v}))} placeholder="e.g. Red Jacket" />
                 <InputField label="Price" value={tempClothingInfo.price} onChange={(v) => setTempClothingInfo(p => ({...p, price: v}))} placeholder="e.g. $50" />
            </div>

            {/* Dimensions */}
            <h3 className="text-sm uppercase tracking-widest text-white/80 font-bold border-b border-white/10 pb-1">Dimensions (cm)</h3>
            <div className="grid grid-cols-2 gap-4">
              <InputField label="Total Length" value={tempClothingMeasurements.totalLength} onChange={(v) => setTempClothingMeasurements(p => ({...p, totalLength: v}))} placeholder="Length" />
              <InputField label="Shoulder" value={tempClothingMeasurements.shoulderWidth} onChange={(v) => setTempClothingMeasurements(p => ({...p, shoulderWidth: v}))} placeholder="Width" />
              <InputField label="Chest" value={tempClothingMeasurements.chestWidth} onChange={(v) => setTempClothingMeasurements(p => ({...p, chestWidth: v}))} placeholder="Width" />
              <InputField label="Sleeve" value={tempClothingMeasurements.sleeveLength} onChange={(v) => setTempClothingMeasurements(p => ({...p, sleeveLength: v}))} placeholder="Length" />
            </div>
            
            <div className="flex gap-3 mt-2">
              <button onClick={() => { setShowClothingModal(false); setTempImage(null); }} className="flex-1 py-3 rounded-xl border border-white/20 hover:bg-white/10 text-white/70">Cancel</button>
              <button 
                onClick={confirmClothingUpload} 
                disabled={!tempImage}
                className={`flex-1 py-3 rounded-xl font-bold shadow-lg transition-all ${tempImage ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:shadow-purple-500/30' : 'bg-white/10 text-white/30 cursor-not-allowed'}`}
              >
                Add Item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Layer 2: Result Overlay */}
      {appState === AppState.RESULT && generatedImage && (
        <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-md animate-in fade-in duration-700 flex items-center justify-center p-4">
           <img 
             src={generatedImage} 
             alt="Try On Result" 
             className="max-w-full max-h-full object-contain rounded-lg shadow-[0_0_50px_rgba(255,255,255,0.2)] border border-white/20" 
           />
        </div>
      )}

      {/* Layer 3: HUD */}
      <div className="absolute inset-0 z-20 pointer-events-none flex flex-col justify-between p-6 md:p-8">
        
        {/* Header */}
        <header className="flex justify-between items-start pointer-events-auto">
          <div className="flex items-center gap-4">
            {/* Back Button (Only in SHOPPING state) */}
            {appState === AppState.SHOPPING && (
              <button 
                onClick={handleBackToScan}
                className="glass-button p-3 rounded-full text-white hover:scale-110 transition-transform group"
                title="Back to Scan"
              >
                <ChevronLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
              </button>
            )}

            <div className="glass-panel px-6 py-4 rounded-2xl flex flex-col">
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-cyan-300 to-purple-300 bg-clip-text text-transparent">Magic Mirror</h1>
              <p className="text-xs text-gray-300 uppercase tracking-widest mt-1">Virtual Atelier</p>
            </div>
          </div>
          
          <div className="glass-panel px-4 py-2 rounded-full flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full shadow-[0_0_10px_currentColor] ${appState === AppState.IDLE ? 'bg-green-400 text-green-400 animate-pulse' : 'bg-purple-400 text-purple-400'}`}></div>
            <span className="text-xs font-bold uppercase tracking-wider text-white/90">
              {appState === AppState.IDLE && "Ready to Scan"}
              {appState === AppState.ANALYZING && "Analyzing Anatomy..."}
              {appState === AppState.SHOPPING && "Select Attire"}
              {appState === AppState.GENERATING_TRYON && "Weaving Fabric..."}
              {appState === AppState.RESULT && "Fitting Complete"}
            </span>
          </div>
        </header>

        {/* Error Notification */}
        {errorMsg && (
          <div className="absolute top-32 left-1/2 transform -translate-x-1/2 glass-panel border-l-4 border-red-500 text-white px-8 py-4 rounded-xl shadow-2xl animate-bounce flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-500" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Loading Spinner */}
        {(appState === AppState.ANALYZING || appState === AppState.GENERATING_TRYON) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-tr from-cyan-500 to-purple-500 rounded-full blur-xl opacity-50 animate-pulse"></div>
              <div className="glass-card p-10 rounded-full">
                <RefreshCw className="w-12 h-12 text-white animate-spin" />
              </div>
            </div>
          </div>
        )}

        {/* Analysis Data Panel - CLICKABLE FOR EDITING */}
        <div className={`pointer-events-auto transition-all duration-700 transform ${analysis ? 'translate-x-0 opacity-100' : '-translate-x-full opacity-0'} absolute left-6 md:left-12 top-40 w-72`}>
          {analysis && (
            <div 
                onClick={openEditBodyMetrics}
                className="glass-panel p-6 rounded-2xl space-y-5 hover:bg-white/10 transition-all cursor-pointer group relative"
            >
              <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <Edit2 className="w-4 h-4 text-cyan-400" />
              </div>

              <div className="flex items-center gap-3 text-purple-300 border-b border-white/10 pb-3">
                <Activity className="w-5 h-5" />
                <h2 className="font-bold uppercase tracking-widest text-sm">Body Metrics</h2>
              </div>
              
              <div className="space-y-4">
                {userMeasurements?.name && (
                   <div className="flex justify-between items-center pb-2 border-b border-white/5">
                    <label className="text-white/60 text-xs uppercase">Name</label>
                    <div className="text-cyan-300 font-bold">{userMeasurements.name}</div>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <label className="text-white/60 text-xs uppercase">Height</label>
                  <div className="text-white font-medium">
                    {userMeasurements?.height ? `${userMeasurements.height}cm` : analysis.heightEstimate}
                  </div>
                </div>
                 <div className="flex justify-between items-center">
                  <label className="text-white/60 text-xs uppercase">Size</label>
                  <div className="text-cyan-300 font-bold text-xl">{analysis.suggestedSize}</div>
                </div>
                {/* Show detailed measurements if present */}
                {userMeasurements?.chest && (
                   <div className="flex justify-between items-center">
                    <label className="text-white/60 text-xs uppercase">Chest</label>
                    <div className="text-white font-medium">{userMeasurements.chest}cm</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Interface */}
        <div className="pointer-events-auto flex flex-col md:flex-row items-end md:items-center justify-between w-full mt-auto gap-6">
          
          {/* Clothing Selector */}
          {appState === AppState.SHOPPING && (
            <div className="w-full md:w-auto overflow-x-auto flex gap-4 pb-4 md:pb-0 scroll-smooth px-2 py-4 mask-gradient">
              {/* Upload Card */}
              <button
                onClick={openClothingModal}
                className="glass-card flex-shrink-0 w-32 md:w-40 aspect-[3/4] rounded-2xl flex flex-col items-center justify-center gap-2 hover:bg-white/10 transition-all border-dashed border-2 border-white/30 text-white/70 hover:text-white hover:border-white"
              >
                <Plus className="w-8 h-8" />
                <span className="text-xs font-bold uppercase">Upload</span>
              </button>

              {/* Catalog Items */}
              {fullCatalog.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedClothing(item)}
                  className={`relative group flex-shrink-0 w-32 md:w-40 aspect-[3/4] rounded-2xl overflow-hidden transition-all duration-300 ${selectedClothing?.id === item.id ? 'ring-2 ring-cyan-400 scale-105 shadow-[0_0_30px_rgba(34,211,238,0.3)]' : 'opacity-80 hover:opacity-100 hover:scale-105'}`}
                >
                  <div className="absolute inset-0 bg-gray-900">
                    <img src={item.image} alt={item.name} className="w-full h-full object-cover opacity-90 group-hover:opacity-100" />
                  </div>
                  
                  {/* Item Info Overlay */}
                  <div className="absolute inset-x-0 bottom-0 glass-panel border-0 border-t rounded-none p-3 pt-6 text-left">
                    <p className="text-xs font-bold text-white truncate">{item.name}</p>
                    <div className="flex justify-between items-center mt-1">
                      {item.isCustom && <span className="text-[9px] bg-purple-500 px-1 rounded text-white">CUSTOM</span>}
                      {item.price && <span className="text-[10px] text-cyan-300 font-mono">{item.price}</span>}
                    </div>
                  </div>
                  
                  {/* Visual Indicator for measurements */}
                  {item.measurements && Object.keys(item.measurements).length > 0 && (
                    <div className="absolute top-2 right-2 bg-black/60 backdrop-blur rounded-full p-1 border border-white/20" title="Custom Measurements Included">
                      <Ruler className="w-3 h-3 text-cyan-400" />
                    </div>
                  )}

                  {/* Hover Detail View (Only for selected) */}
                  {selectedClothing?.id === item.id && item.measurements && Object.values(item.measurements).some(v => v) && (
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col justify-center px-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-xs text-white/50 uppercase mb-2 border-b border-white/10 pb-1">Details</p>
                      <div className="space-y-1 text-xs text-white">
                        {item.measurements.totalLength && <div className="flex justify-between"><span>Length</span><span>{item.measurements.totalLength}</span></div>}
                        {item.measurements.chestWidth && <div className="flex justify-between"><span>Chest</span><span>{item.measurements.chestWidth}</span></div>}
                        {item.measurements.shoulderWidth && <div className="flex justify-between"><span>Shldr</span><span>{item.measurements.shoulderWidth}</span></div>}
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Controls */}
          <div className="flex gap-4 ml-auto items-center">
            {/* IDLE State Controls */}
            {appState === AppState.IDLE && (
              <div className="flex gap-3">
                <button 
                  onClick={openBodyModal}
                  className="glass-button p-4 rounded-full text-white hover:scale-110 transition-transform"
                  title="Upload Photo"
                >
                  <Upload className="w-6 h-6" />
                </button>
                <button 
                  onClick={handleScanBody}
                  className="glass-button px-8 py-4 rounded-full text-white font-bold tracking-widest uppercase hover:bg-white/10 transition-all shadow-[0_0_30px_rgba(255,255,255,0.1)] hover:shadow-[0_0_50px_rgba(74,222,128,0.3)] flex items-center gap-3"
                >
                  <Camera className="w-6 h-6" />
                  <span>Scan Body</span>
                </button>
              </div>
            )}

            {/* SHOPPING State Controls */}
            {appState === AppState.SHOPPING && (
              <div className="flex flex-col md:flex-row gap-4 items-end md:items-center">
                
                {/* Size Selector */}
                {selectedClothing && (
                  <div className="glass-panel p-1 rounded-full flex items-center">
                    {AVAILABLE_SIZES.map((size) => (
                      <button
                        key={size}
                        onClick={() => setSelectedSize(size)}
                        className={`w-10 h-10 rounded-full text-xs font-bold transition-all ${selectedSize === size ? 'bg-white text-black scale-105 shadow-lg' : 'text-white/70 hover:bg-white/10'}`}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                )}

                <button 
                  onClick={handleTryOn}
                  disabled={!selectedClothing}
                  className={`glass-button px-8 py-4 rounded-full font-bold tracking-widest uppercase flex items-center gap-3 transition-all ${selectedClothing ? 'text-white shadow-[0_0_40px_rgba(168,85,247,0.4)] hover:shadow-[0_0_60px_rgba(168,85,247,0.6)] bg-white/10' : 'text-gray-500 cursor-not-allowed opacity-50'}`}
                >
                  <Shirt className="w-6 h-6" />
                  <span>Try On</span>
                  {selectedClothing && <ChevronRight className="w-5 h-5 animate-pulse" />}
                </button>
              </div>
            )}

            {/* RESULT State Controls */}
            {appState === AppState.RESULT && (
              <div className="flex gap-3">
                <button 
                  onClick={handleDownload}
                  className="glass-button px-6 py-3 rounded-xl text-white font-semibold flex items-center gap-2 hover:bg-green-500/20 hover:border-green-500/50"
                  title="Save Result"
                >
                  <Download className="w-5 h-5" />
                  <span>Save</span>
                </button>
                 <button 
                  onClick={() => setAppState(AppState.SHOPPING)}
                  className="glass-button px-6 py-3 rounded-xl text-white font-semibold flex items-center gap-2 hover:bg-white/10"
                >
                  <ShoppingBag className="w-5 h-5" />
                  <span>Shop</span>
                </button>
                <button 
                  onClick={resetProcess}
                  className="glass-button px-6 py-3 rounded-xl text-white font-semibold flex items-center gap-2 hover:bg-red-500/20 hover:border-red-500/50"
                >
                  <X className="w-5 h-5" />
                  <span>Close</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;