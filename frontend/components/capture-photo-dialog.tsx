'use client'

import React, { useRef, useState, useCallback } from 'react'
import Webcam from 'react-webcam'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Camera, RefreshCw, Check, Upload, Image as ImageIcon } from 'lucide-react'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { toast } from "sonner"

interface CapturePhotoDialogProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    applicationId: number
    onSuccess: () => void
}

const dataURLtoBlob = (dataUrl: string): Blob => {
    try {
        const arr = dataUrl.split(',');
        const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    } catch (e) {
        console.error("Failed to convert data URL to Blob:", e);
        throw new Error("Invalid image format or corrupt data");
    }
}

export function CapturePhotoDialog({ isOpen, onOpenChange, applicationId, onSuccess }: CapturePhotoDialogProps) {
    const webcamRef = useRef<Webcam>(null)
    const [imgSrc, setImgSrc] = useState<string | null>(null)
    const [isUploading, setIsUploading] = useState(false)
    const [activeTab, setActiveTab] = useState("capture")
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [cameraError, setCameraError] = useState<string | null>(null)

    const capture = useCallback(() => {
        const imageSrc = webcamRef.current?.getScreenshot()
        setImgSrc(imageSrc || null)
    }, [webcamRef])

    const handleCameraError = useCallback((err: string | DOMException) => {
        const msg = typeof err === 'string' ? err : err.message
        if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('notallowed')) {
            setCameraError('Camera access was denied. Please allow camera access in your browser settings, or use the Upload tab instead.')
        } else if (msg.toLowerCase().includes('notfound') || msg.toLowerCase().includes('devicenotfound')) {
            setCameraError('No camera was found on this device. Please use the Upload tab to add a photo.')
        } else {
            setCameraError('Camera is unavailable. Please use the Upload tab to upload a photo instead.')
        }
    }, [])

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            const reader = new FileReader()
            reader.onloadend = () => {
                setImgSrc(reader.result as string)
            }
            reader.readAsDataURL(file)
        }
    }

    const retake = () => {
        setImgSrc(null)
    }

    const uploadPhoto = async () => {
        if (!imgSrc) return
        
        setIsUploading(true)
        try {
            // Convert base64 to blob
            const blob = dataURLtoBlob(imgSrc)
            
            const formData = new FormData()
            formData.append('photo', blob, 'candidate_photo.jpg')

            await APIClient.postFormData(`/api/onboarding/applications/${applicationId}/capture-photo`, formData)

            toast.success("Candidate photo added successfully.")
            onSuccess()
            onOpenChange(false)
            setImgSrc(null)
        } catch (error) {
            console.error(error)
            toast.error(error instanceof Error ? error.message : "Failed to upload photo")
        } finally {
            setIsUploading(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { onOpenChange(open); if(!open) setImgSrc(null); }}>
            <DialogContent className="sm:max-w-md border border-border/80 bg-card/90 backdrop-blur-xl shadow-2xl rounded-3xl">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold tracking-tight">Add Candidate Photo</DialogTitle>
                    <DialogDescription className="text-muted-foreground">
                        Provide a photo of the candidate for their official ID card.
                    </DialogDescription>
                </DialogHeader>
                
                <Tabs defaultValue="capture" className="w-full" onValueChange={(v) => { setActiveTab(v); setImgSrc(null); setCameraError(null); }}>
                    <TabsList className="grid w-full grid-cols-2 mb-4 bg-muted/40 backdrop-blur-md border border-border/40 p-1 rounded-2xl">
                        <TabsTrigger value="capture" className="gap-2 rounded-xl data-[state=active]:shadow-sm">
                            <Camera className="h-4 w-4" />
                            Take Photo
                        </TabsTrigger>
                        <TabsTrigger value="upload" className="gap-2 rounded-xl data-[state=active]:shadow-sm">
                            <Upload className="h-4 w-4" />
                            Upload
                        </TabsTrigger>
                    </TabsList>
 
                    <TabsContent value="capture" className="mt-0">
                        <div className="flex flex-col items-center justify-center bg-zinc-950 rounded-2xl overflow-hidden aspect-video relative shadow-2xl border border-border/80 ring-1 ring-primary/10">
                            {cameraError ? (
                                <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                                    <svg className="h-10 w-10 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
                                    <p className="text-sm font-semibold text-amber-300">{cameraError}</p>
                                </div>
                            ) : !imgSrc ? (
                                <>
                                    <Webcam
                                        audio={false}
                                        ref={webcamRef}
                                        screenshotFormat="image/jpeg"
                                        className="w-full h-full object-cover"
                                        videoConstraints={{ facingMode: "user" }}
                                        onUserMediaError={handleCameraError}
                                    />
                                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 animate-in fade-in duration-300">
                                        <Button 
                                            onClick={capture} 
                                            variant="secondary" 
                                            className="rounded-full h-12 w-12 p-0 bg-white/20 hover:bg-white/40 backdrop-blur-md border-white/50 border shadow-lg hover:scale-110 active:scale-90 transition-all duration-200"
                                        >
                                            <Camera className="h-6 w-6 text-white" />
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <img src={imgSrc} className="w-full h-full object-cover" alt="Captured" />
                                    {/* Persistent Glassmorphic Control Overlay */}
                                    <div className="absolute bottom-3 left-3 right-3 bg-background/80 backdrop-blur-xl border border-border/80 rounded-2xl p-2.5 flex items-center justify-between shadow-xl animate-in slide-in-from-bottom-2 duration-300">
                                        <span className="text-xs font-bold text-foreground/90 pl-2">Photo Captured</span>
                                        <Button 
                                            onClick={retake} 
                                            variant="outline" 
                                            size="sm" 
                                            className="h-8 rounded-lg bg-background/50 hover:bg-background/95 hover:text-destructive text-muted-foreground border-border/60 transition-all active:scale-95 duration-200"
                                        >
                                            <RefreshCw className="h-3.5 w-3.5 mr-2" />
                                            Retake
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                    </TabsContent>
 
                    <TabsContent value="upload" className="mt-0">
                        <div className="group flex flex-col items-center justify-center border-2 border-dashed border-border/80 hover:border-primary/50 rounded-2xl aspect-video bg-muted/20 hover:bg-primary/[0.02] dark:hover:bg-primary/[0.03] transition-all duration-300 relative overflow-hidden cursor-pointer shadow-inner" onClick={() => fileInputRef.current?.click()}>
                            {!imgSrc ? (
                                <div className="text-center p-6 flex flex-col items-center gap-3">
                                    <div className="p-3 bg-background border border-border/80 rounded-2xl shadow-md transition-all duration-300 group-hover:scale-110 group-hover:rotate-3 group-hover:ring-4 group-hover:ring-primary/10">
                                        <ImageIcon className="h-6 w-6 text-muted-foreground" />
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-sm font-bold text-foreground">Choose a photo</p>
                                        <p className="text-xs text-muted-foreground">JPG, PNG or WEBP (Max 5MB)</p>
                                    </div>
                                    <input 
                                        type="file" 
                                        accept="image/*" 
                                        className="hidden" 
                                        ref={fileInputRef}
                                        onChange={handleFileUpload}
                                    />
                                    <Button 
                                        variant="secondary" 
                                        size="sm"
                                        className="rounded-xl active:scale-95 transition-all shadow-sm"
                                    >
                                        Browse Files
                                    </Button>
                                </div>
                            ) : (
                                <>
                                    <img src={imgSrc} className="w-full h-full object-cover" alt="Uploaded" />
                                    {/* Persistent Glassmorphic Control Overlay */}
                                    <div className="absolute bottom-3 left-3 right-3 bg-background/80 backdrop-blur-xl border border-border/80 rounded-2xl p-2.5 flex items-center justify-between shadow-xl animate-in slide-in-from-bottom-2 duration-300">
                                        <span className="text-xs font-bold text-foreground/90 pl-2">Photo Loaded</span>
                                        <Button 
                                            onClick={retake} 
                                            variant="outline" 
                                            size="sm" 
                                            className="h-8 rounded-lg bg-background/50 hover:bg-background/95 hover:text-destructive text-muted-foreground border-border/60 transition-all active:scale-95 duration-200"
                                        >
                                            <RefreshCw className="h-3.5 w-3.5 mr-2" />
                                            Change Photo
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                    </TabsContent>
                </Tabs>
 
                <DialogFooter className="sm:justify-between pt-4 border-t border-border/40">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-xl active:scale-95 transition-all">Cancel</Button>
                    {imgSrc && (
                        <Button 
                            onClick={uploadPhoto} 
                            disabled={isUploading}
                            className="bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] shadow-md shadow-emerald-600/10 text-white font-bold px-8 rounded-xl transition-all flex items-center justify-center gap-1.5"
                        >
                            {isUploading ? "Uploading..." : `Save ${activeTab === 'capture' ? 'Capture' : 'Upload'}`}
                            {!isUploading && <Check className="ml-2 h-4 w-4" />}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
