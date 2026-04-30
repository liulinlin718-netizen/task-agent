import { useState, useCallback } from "react";
import Cropper, { Area } from "react-easy-crop";
import { useStore } from "../Store";

export function Profile() {
  const { state, setState } = useStore();
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);

  const updateProfile = (key: keyof typeof state.profile, value: string) => {
    setState(s => ({ ...s, profile: { ...s.profile, [key]: value } }));
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageToCrop(reader.result as string);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
      };
      reader.readAsDataURL(file);
    }
  };

  const onCropComplete = useCallback((croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const getCroppedImg = async (imageSrc: string, pixelCrop: Area): Promise<string> => {
    const image = new Image();
    image.src = imageSrc;
    await new Promise((resolve) => {
      image.onload = resolve;
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    if (!ctx) return "";

    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;

    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height
    );

    return canvas.toDataURL("image/jpeg", 0.9);
  };

  const handleCropConfirm = async () => {
    if (imageToCrop && croppedAreaPixels) {
      const croppedImage = await getCroppedImg(imageToCrop, croppedAreaPixels);
      updateProfile('avatar', croppedImage);
      setImageToCrop(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto auto-hide-scrollbar w-full h-full pb-20">
      {/* Cropper Modal */}
      {imageToCrop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-white dark:bg-neutral-900 rounded-3xl overflow-hidden w-full max-w-md shadow-2xl flex flex-col">
            <div className="p-4 border-b border-gray-100 dark:border-neutral-800 flex justify-between items-center">
              <h3 className="font-semibold text-lg">调整头像</h3>
              <button 
                onClick={() => setImageToCrop(null)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                取消
              </button>
            </div>
            
            <div className="relative w-full h-[400px]">
              <Cropper
                image={imageToCrop}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="rect"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
                classes={{
                  cropAreaClassName: "rounded-[2.5rem] border-2 border-white/50"
                }}
              />
            </div>
            
            <div className="p-6 bg-gray-50 dark:bg-neutral-800/50">
              <div className="flex items-center gap-4 mb-6">
                <span className="text-sm text-gray-500">缩放</span>
                <input
                  type="range"
                  value={zoom}
                  min={1}
                  max={3}
                  step={0.1}
                  aria-labelledby="Zoom"
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="w-full accent-blue-600"
                />
              </div>
              <button 
                onClick={handleCropConfirm}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors shadow-sm"
              >
                确认裁剪
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col w-full max-w-3xl mx-auto py-12 px-6 sm:px-8 animate-in fade-in duration-300">
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2 text-foreground">个人档案</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-10 text-[15px]">
          提供你的背景信息，以便贴身助理更好地协助你。
        </p>

        {/* Avatar Section */}
        <div className="flex justify-center mb-12">
          <div className="relative group flex flex-col items-center">
            <div className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-[2.5rem] overflow-hidden bg-white dark:bg-[#1C1C1E] shadow-sm border border-gray-100 dark:border-neutral-800 transition-transform duration-300 group-hover:scale-105 group-active:scale-95 flex items-center justify-center">
              {state.profile.avatar ? (
                <img src={state.profile.avatar} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <div className="text-gray-400 flex flex-col items-center justify-center gap-2">
                  <svg className="w-8 h-8 text-blue-500 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span className="text-[13px] font-medium text-gray-500 dark:text-gray-400">设置头像</span>
                </div>
              )}
              <input 
                type="file" 
                accept="image/*" 
                onChange={handleAvatarUpload}
                onClick={e => (e.currentTarget.value = '')}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </div>
            {!state.profile.avatar && <div className="mt-4 text-[13px] text-gray-400">点击上传你的照片</div>}
          </div>
        </div>

        {/* Grouped Information Cards */}
        <div className="space-y-10">
          
          {/* Base Info Group */}
          <div>
            <h3 className="text-[13px] uppercase tracking-wider text-gray-500 dark:text-gray-400 ml-4 mb-2 font-medium">基本信息</h3>
            <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-sm border border-gray-100/50 dark:border-white/[0.02] overflow-hidden">
              
              {/* Row 1 */}
              <div className="flex flex-col sm:flex-row sm:items-center px-4 sm:px-5 py-3 sm:py-4 relative">
                <label className="sm:w-1/3 text-[16px] text-gray-900 dark:text-gray-50 mb-1 sm:mb-0">
                  职业与领域
                </label>
                <input 
                  value={state.profile.major} 
                  onChange={e => updateProfile('major', e.target.value)} 
                  placeholder="例如：产品经理" 
                  className="flex-1 bg-transparent text-[16px] sm:text-right text-blue-600 dark:text-blue-400 placeholder:text-gray-400 dark:placeholder:text-gray-600 outline-none"
                />
                {/* Internal Divider */}
                <div className="absolute bottom-0 left-4 sm:left-5 right-0 h-[1px] bg-gray-100 dark:bg-white/5" />
              </div>

              {/* Row 2 */}
              <div className="flex flex-col sm:flex-row sm:items-center px-4 sm:px-5 py-3 sm:py-4">
                <label className="sm:w-1/3 text-[16px] text-gray-900 dark:text-gray-50 mb-1 sm:mb-0">
                  核心技能栈
                </label>
                <input 
                  value={state.profile.skills} 
                  onChange={e => updateProfile('skills', e.target.value)} 
                  placeholder="例如：Python, React" 
                  className="flex-1 bg-transparent text-[16px] sm:text-right text-blue-600 dark:text-blue-400 placeholder:text-gray-400 dark:placeholder:text-gray-600 outline-none"
                />
              </div>

            </div>
          </div>

          {/* Details Group */}
          <div>
            <h3 className="text-[13px] uppercase tracking-wider text-gray-500 dark:text-gray-400 ml-4 mb-2 font-medium">详细描述</h3>
            <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-sm border border-gray-100/50 dark:border-white/[0.02] overflow-hidden flex flex-col">
              
              {/* Bio block */}
              <div className="relative">
                <label className="block text-[16px] text-gray-900 dark:text-gray-50 px-4 sm:px-5 pt-4 pb-1">
                  个人简介
                </label>
                <textarea 
                  value={state.profile.bio || ''} 
                  onChange={e => updateProfile('bio', e.target.value)} 
                  placeholder="自我介绍、兴趣爱好、详细背景等..."
                  className="w-full min-h-[100px] bg-transparent text-[16px] px-4 sm:px-5 pb-4 resize-none outline-none text-blue-600 dark:text-blue-400 placeholder:text-gray-400 dark:placeholder:text-gray-600 leading-relaxed"
                />
                <div className="absolute bottom-0 left-4 sm:left-5 right-0 h-[1px] bg-gray-100 dark:bg-white/5" />
              </div>

              {/* Goal block */}
              <div>
                <label className="block text-[16px] text-gray-900 dark:text-gray-50 px-4 sm:px-5 pt-4 pb-1">
                  当前核心目标
                </label>
                <textarea 
                  value={state.profile.goal || ''} 
                  onChange={e => updateProfile('goal', e.target.value)} 
                  placeholder="例如：在今年Q3完成新产品的上线..."
                  className="w-full min-h-[100px] bg-transparent text-[16px] px-4 sm:px-5 pb-4 resize-none outline-none text-blue-600 dark:text-blue-400 placeholder:text-gray-400 dark:placeholder:text-gray-600 leading-relaxed"
                />
              </div>

            </div>
            <p className="mt-3 ml-4 text-[13px] text-gray-400 dark:text-gray-500">
              这些信息将被用于个性化地调整应用的行为和回复风格。
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
