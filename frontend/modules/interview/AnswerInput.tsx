import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Mic, MicOff, Loader2, Send, ShieldAlert, CheckCircle2 } from 'lucide-react';


interface AnswerInputProps {
    onSubmit: (answer: string) => void;
    onPrev?: () => void;
    onNext?: () => void;
    disabled: boolean;
    isEvaluating?: boolean;
    interviewId?: string;
    isListening?: boolean;
    isTranscribing?: boolean;
    onStartRecording?: (callback: (text: string) => void) => void;
    onStopRecording?: () => void;
    isStuck?: boolean;
    onRetry?: () => void;
    options?: string[];
    initialValue?: string | null;
    isSubmitted?: boolean;
    questionId?: number;
    onClipboardViolation?: (type: 'copy' | 'paste' | 'cut') => void;
}


export default function AnswerInput({
    onSubmit,
    onPrev,
    onNext,
    disabled,
    isEvaluating = false,
    interviewId,
    isListening = false,
    isTranscribing = false,
    onStartRecording,
    onStopRecording,
    isStuck = false,
    onRetry,
    options = [],
    initialValue = '',
    isSubmitted = false,
    questionId,
    onClipboardViolation,
}: AnswerInputProps) {
    const [text, setText] = useState('');
    const [selectedOption, setSelectedOption] = useState<number | null>(null);

    const isMCQ = options && options.length > 0;

    // Load draft from sessionStorage when questionId changes
    useEffect(() => {
        if (!isSubmitted && questionId && interviewId) {
            const savedDraft = sessionStorage.getItem(`draft_${interviewId}_${questionId}`);
            if (savedDraft !== null && !isMCQ) {
                setText(savedDraft);
                return;
            }
        }
        if (isSubmitted) {
            setSelectedOption(null);
            setText('');
            return;
        }
        if (options.length > 0 && initialValue) {
            const index = initialValue.charCodeAt(0) - 65;
            if (index >= 0 && index < options.length) {
                setSelectedOption(index);
                setText('');
            } else {
                setSelectedOption(null);
                setText(initialValue || '');
            }
        } else {
            setSelectedOption(null);
            setText(initialValue || '');
        }
    }, [questionId, initialValue, isSubmitted, interviewId, isMCQ]);

    // Save draft to sessionStorage when text changes
    useEffect(() => {
        if (!isSubmitted && questionId && interviewId && !isMCQ) {
            if (text.trim()) {
                sessionStorage.setItem(`draft_${interviewId}_${questionId}`, text);
            } else {
                sessionStorage.removeItem(`draft_${interviewId}_${questionId}`);
            }
        }
    }, [text, questionId, interviewId, isSubmitted, isMCQ]);

    const handleTranscriptionResult = (transcribedText: string) => {
        setText((prev) => {
            const trimmedPrev = prev.trim();
            return trimmedPrev ? `${trimmedPrev} ${transcribedText}` : transcribedText;
        });
    };

    const handleMicClick = (e: React.MouseEvent) => {
        e.preventDefault();
        if (isListening) {
            onStopRecording?.();
        } else {
            onStartRecording?.(handleTranscriptionResult);
        }
    };

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (isListening) onStopRecording?.();
        
        const finalAnswer = options.length > 0 && selectedOption !== null 
            ? String.fromCharCode(65 + selectedOption)
            : text.trim();

        if (finalAnswer && !disabled) {
            onSubmit(finalAnswer);
            if (interviewId && questionId) {
                sessionStorage.removeItem(`draft_${interviewId}_${questionId}`);
            }
            setText('');
            setSelectedOption(null);
        }
    };

    return (
        <Card className="w-full bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] hover:shadow-[0_15px_30px_rgb(0,0,0,0.05)] transition-all duration-300 rounded-2xl overflow-hidden">
            <CardContent className="p-4 sm:p-6 lg:p-10">
                <form onSubmit={handleSubmit} className="flex flex-col space-y-4 lg:space-y-8">
                    {isSubmitted ? (
                        <div className="flex flex-col items-center justify-center py-10 lg:py-16 px-4 bg-muted/30 rounded-2xl border border-dashed border-border/80 text-center space-y-4 transition-all">
                            <div className="w-16 h-16 lg:w-20 lg:h-20 bg-green-500/10 rounded-full flex items-center justify-center text-green-500 animate-pulse border border-green-500/20">
                                <CheckCircle2 className="w-8 h-8 lg:w-10 lg:h-10" />
                            </div>
                            <h3 className="text-lg lg:text-2xl font-extrabold text-foreground tracking-tight">
                                Answer Submitted Successfully
                            </h3>
                            <p className="text-xs lg:text-sm text-muted-foreground font-medium max-w-md leading-relaxed">
                                Your response has been locked and evaluated. Use the navigation controls below to review other active questions.
                            </p>
                        </div>
                    ) : isMCQ ? (
                        <div className="space-y-4 lg:space-y-6">
                            <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Select One Option</span>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 lg:gap-4">
                                {options.map((opt, i) => (
                                    <button
                                        key={i}
                                        type="button"
                                        onClick={() => setSelectedOption(i)}
                                        className={`p-4 lg:p-6 rounded-xl lg:rounded-2xl border-2 text-left transition-all flex items-center gap-3 lg:gap-4 group active:scale-[0.99] ${selectedOption === i ? 'bg-primary/10 border-primary shadow-md shadow-primary/5' : 'bg-muted/30 border-transparent hover:border-border hover:bg-card/30'}`}
                                    >
                                        <div className={`w-8 h-8 lg:w-10 lg:h-10 rounded-lg lg:rounded-xl flex items-center justify-center font-black text-xs lg:text-sm transition-colors ${selectedOption === i ? 'bg-primary text-primary-foreground' : 'bg-background border border-border text-muted-foreground group-hover:border-primary/40 group-hover:text-primary'}`}>
                                            {String.fromCharCode(65 + i)}
                                        </div>
                                        <span className={`text-sm lg:text-lg font-bold ${selectedOption === i ? 'text-foreground' : 'text-muted-foreground'}`}>{opt}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4 lg:space-y-6">
                             <span className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-1">Detailed Response</span>
                             <Textarea
                                placeholder={isEvaluating ? "The board is reviewing your response..." : "Provide your response here, or use the microphone to speak..."}
                                className="min-h-[120px] lg:min-h-[180px] resize-y text-sm lg:text-lg p-4 lg:p-8 bg-background/50 focus:bg-background hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all rounded-2xl lg:rounded-3xl border-border"
                                value={text}
                                onChange={(e) => setText(e.target.value)}
                                onCopy={(e) => { e.preventDefault(); onClipboardViolation?.('copy'); }}
                                onPaste={(e) => { e.preventDefault(); onClipboardViolation?.('paste'); }}
                                onCut={(e) => { e.preventDefault(); onClipboardViolation?.('cut'); }}
                                disabled={disabled || isEvaluating}
                            />
                        </div>
                    )}
                    
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-2 lg:pt-4">
                        <div className="flex items-center gap-4 lg:gap-6 w-full sm:w-auto">
                            <button 
                                type="button" 
                                onClick={onPrev}
                                className="flex items-center gap-2 text-muted-foreground hover:text-foreground active:scale-[0.99] transition-all disabled:opacity-30"
                                disabled={!onPrev}
                            >
                                <span className="text-[10px] lg:text-xs font-black uppercase tracking-widest">{'<'} Prev</span>
                            </button>
                            <button 
                                type="button" 
                                onClick={onNext}
                                className="flex items-center gap-2 text-muted-foreground hover:text-foreground active:scale-[0.99] transition-all disabled:opacity-30"
                                disabled={!onNext}
                            >
                                <span className="text-[10px] lg:text-xs font-black uppercase tracking-widest">Next {'>'}</span>
                            </button>
                            <span className="text-[9px] lg:text-[10px] text-muted-foreground font-medium italic hidden xs:block">
                                {isSubmitted ? "Reviewing completed question" : "Answer each question and submit to move forward"}
                            </span>
                        </div>

                        {!isSubmitted && (
                            <div className="flex items-center gap-2 lg:gap-4 w-full sm:w-auto">

                                
                                {!isMCQ && (
                                    <Button 
                                        type="button" 
                                        variant={isListening ? "destructive" : "outline"}
                                        size="icon" 
                                        disabled={disabled || isTranscribing} 
                                        onClick={handleMicClick}
                                        className={`w-10 h-10 lg:w-14 lg:h-14 rounded-xl lg:rounded-2xl shadow-sm transition-all active:scale-[0.99] ${isListening ? "animate-pulse shadow-lg shadow-red-500/20" : "hover:border-primary hover:text-primary"}`}
                                    >
                                        {isTranscribing ? <Loader2 className="w-4 h-4 lg:w-5 lg:h-5 animate-spin" /> : isListening ? <MicOff className="w-4 h-4 lg:w-5 lg:h-5" /> : <Mic className="w-4 h-4 lg:w-5 lg:h-5" />}
                                    </Button>
                                )}

                                <Button 
                                    type="submit" 
                                    disabled={disabled || (!text.trim() && selectedOption === null && !isListening)} 
                                    className={`flex-[2] sm:flex-none h-10 lg:h-14 px-6 lg:px-10 rounded-xl lg:rounded-2xl shadow-lg font-black text-[10px] lg:text-sm uppercase tracking-widest transition-all active:scale-[0.99] ${selectedOption !== null || text.trim() ? 'bg-primary hover:bg-primary/95 text-primary-foreground shadow-primary/20' : 'bg-muted text-muted-foreground/50'}`}
                                >
                                    Submit <span className="hidden xs:inline">Answer</span> <Send className="w-3 h-3 lg:w-4 lg:h-4 ml-1 lg:ml-2" />
                                </Button>
                            </div>
                        )}
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
