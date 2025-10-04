"use client"
import React, { useEffect, useRef, useId, useState } from 'react';
import { cancelActiveRequest, isRequestActive } from '../utils/DynamicMessage';
import { FaPlus, FaMicrophone, FaPaperPlane, FaImage } from 'react-icons/fa';
import { showErrorToast, showSuccessToast } from "../utils/toast";
import AudioSpectrumModal from './AudioSpectrumModal';
import { Thread } from '../utils/Thread';
import { FaTimes } from 'react-icons/fa';

// ChatInput props:
// - actualThread: currently active Thread or null
// - isNewestBranch: whether the user can type/send (controls read-only state)
// - isShareThread: if true, the input is disabled because the thread is shared
// - handleMessageSend: function to call to send the message. Signature:
//     (thread: Thread, value: string, files?: File[]) => Promise<void> | void
type Props = {
    actualThread: Thread | null;
    isNewestBranch: boolean;
    isShareThread: boolean;
    handleMessageSend: (thread: Thread, value: string, files?: File[], imageGeneration?: boolean) => Promise<void> | void;
    // FIXED: accept both Blob and string (AudioSpectrumModal may send a Blob)
    handleAudioSend?: (thread: Thread, value: Blob | string) => Promise<void> | void;
};

export default function ChatInput({ actualThread, isNewestBranch, isShareThread, handleMessageSend, handleAudioSend }: Props) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const uid = useId();
    const fileInputId = `chat-file-input-${uid}`;
    const textInputId = `chat-input-${uid}`;
    type SelectedFile = { file: File; previewUrl?: string };
    const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
    const [imageGenerationMode, setImageGenerationMode] = useState(false);
    const [showAudioModal, setShowAudioModal] = useState(false);
    const [ttsKeyValid, setTtsKeyValid] = useState<boolean | null>(null); // null = loading, true/false = validated

    const MAX_FILES = 10;
    const MAX_SIZE = 8 * 1024 * 1024; // 8 MB
    // adjust textarea height on input
    useEffect(() => {
        // safety: ensure initial height is correct
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, []);
    // adjust textarea height on input
    function onInput(e: React.FormEvent<HTMLTextAreaElement>) {
        const el = e.currentTarget as HTMLTextAreaElement;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }
    // handle Enter key (without Shift) to send message
    async function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const value = textareaRef.current?.value || "";
            if (value.trim().length === 0) {
                showErrorToast(`Vous devez entrer un message avant d'envoyer`);
                return;
            }
            if (textareaRef.current) textareaRef.current.value = "";
            if (!actualThread) {
                showErrorToast('Aucun thread ouvert');
                return;
            }
            const files = [...selectedFiles];
            setSelectedFiles(prev => {
                prev.forEach(p => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
                return [];
            });
            await handleMessageSend(actualThread, value, files.map(sf => sf.file), imageGenerationMode);
            
            const el = e.currentTarget as HTMLTextAreaElement;
            el.style.height = `${el.scrollHeight}px`;
        }
    }
    // Handle send button click
    async function onSendClick() {
        if (!isNewestBranch) return;
        const value = textareaRef.current?.value || "";
            if (value.trim().length === 0) {
            showErrorToast(`Vous devez entrer un message avant d'envoyer`);
            return;
        }
    if (textareaRef.current) textareaRef.current.value = "";
        if (!actualThread) {
            showErrorToast('Aucun thread ouvert');
            return;
        }
        
        const files = [...selectedFiles];
        setSelectedFiles(prev => {
            prev.forEach(p => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
            return [];
        });
        await handleMessageSend(actualThread, value, files.map(sf => sf.file), imageGenerationMode);
        // clear selected files after sending
    }
    // Handle file input change
    function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
        const fileList = e.currentTarget.files;
        if (!fileList) return;
        const newFilesRaw = Array.from(fileList);
        const newFiles = newFilesRaw.map(f => {
            // create preview for browser-displayable images
            const mime = (f.type || '').toLowerCase();
            if (mime.startsWith('image/')) {
                try {
                    const url = URL.createObjectURL(f);
                    return { file: f, previewUrl: url } as SelectedFile;
                } catch (e) {
                    return { file: f } as SelectedFile;
                }
            }
            return { file: f } as SelectedFile;
        });

        // Validate count
        if (selectedFiles.length + newFiles.length > MAX_FILES) {
            const allowed = Math.max(0, MAX_FILES - selectedFiles.length);
            const msg = `Vous pouvez sélectionner au maximum ${MAX_FILES} fichiers (il reste ${allowed}).`;
            showErrorToast(msg);
            e.currentTarget.value = '';
            return;
        }

        // Validate sizes
        const oversized = newFiles.filter(sf => sf.file.size > MAX_SIZE);
        if (oversized.length > 0) {
            const names = oversized.map(sf => sf.file.name).join(', ');
            const msg = `Les fichiers suivants dépassent la taille maximale de 8MB: ${names}`;
            showErrorToast(msg);
            e.currentTarget.value = '';
            return;
        }
        setSelectedFiles(prev => [...prev, ...newFiles]);
        e.currentTarget.value = '';
    }
    // Handle microphone button click (stub)
    function onMicClick() {
        if (!isNewestBranch) return;
        // Do not open if a request is active for this thread
        try {
            const id = actualThread?.id ?? '';
            if (id && isRequestActive(id)) {
                showErrorToast('Une requête est en cours — veuillez patienter');
                return;
            }
        } catch (e) {
            // if isRequestActive not available or errors, fallback to allowing
        }
        setShowAudioModal(true);
    }

    // Check server-side TTS API key validity on mount
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const res = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ validate: true }) });
                if (!mounted) return;
                if (!res.ok) {
                    setTtsKeyValid(false);
                    return;
                }
                const json = await res.json().catch(() => ({}));
                setTtsKeyValid(Boolean(json?.ok));
            } catch (e) {
                if (!mounted) return;
                setTtsKeyValid(false);
            }
        })();
        return () => { mounted = false; };
    }, []);
    // Remove a selected file by index
    function removeFile(index: number) {
        setSelectedFiles(prev => {
            const toRemove = prev[index];
            if (toRemove && toRemove.previewUrl) URL.revokeObjectURL(toRemove.previewUrl);
            return prev.filter((_, i) => i !== index);
        });
    }
    // Format bytes as human-readable text
    function formatBytes(bytes: number) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    // Get icon URL for a file based on its type/extension
    function getFileIcon(file: File) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const mime = (file.type || '').toLowerCase();

        // Prioritize mime types for images/video/audio
        if (mime.startsWith('image/')) return '/file/image.png';
        if (mime.startsWith('video/')) return '/file/video.png';
        if (mime.startsWith('audio/')) return '/file/audio.png';

        // Map by extension
        const map: Record<string, string> = {
            'png': '/file/image.png',
            'jpg': '/file/image.png',
            'jpeg': '/file/image.png',
            'gif': '/file/image.png',
            'bmp': '/file/image.png',
            'webp': '/file/image.png',
            'svg': '/file/image.png',
            'pdf': '/file/pdf.png',
            'doc': '/file/doc.png',
            'docx': '/file/doc.png',
            'xls': '/file/xls.png',
            'xlsx': '/file/xls.png',
            'ppt': '/file/ppt.png',
            'pptx': '/file/ppt.png',
            'txt': '/file/txt.png',
            'md': '/file/txt.png',
            'zip': '/file/archive.png',
            'rar': '/file/archive.png',
            '7z': '/file/archive.png',
            'mp3': '/file/audio.png',
            'wav': '/file/audio.png',
            'mp4': '/file/video.png',
            'mov': '/file/video.png',
            'ogg': '/file/audio.png',
        };

        return map[ext] || '/file/file.png';
    }

    // cleanup object URLs on unmount
    useEffect(() => {
        return () => {
            selectedFiles.forEach(sf => {
                if (sf.previewUrl) URL.revokeObjectURL(sf.previewUrl);
            });
        };
    }, [selectedFiles]);

    return (
        <div className="flex flex-col items-center p-0 w-full">
            {selectedFiles.length > 0 && (
                <>
                <div className="w-full mb-2 px-2">
                    <div className="flex flex-nowrap gap-2 overflow-x-auto ">
                        {selectedFiles.map((sf, index) => {
                            const file = sf.file;
                            const src = sf.previewUrl ? sf.previewUrl : getFileIcon(file);
                            return (
                                <div key={index} className="flex items-center flex-col bg-gray-700 text-white px-3 py-1 rounded-md min-w-48 max-w-48">
                                    <FaTimes className="self-end cursor-pointer hover:text-red-500" onClick={() => removeFile(index)} />
                                    <hr className='w-full border-gray-600 my-1' />
                                    <img
                                        src={src}
                                        alt={file.name}
                                        className="object-cover w-32 h-32 rounded-md "
                                        onError={(e) => {
                                            (e.currentTarget as HTMLImageElement).src = '/file/file.png';
                                        }}
                                    />
                                    <hr className='w-full border-gray-600 my-1' />
                                    <span className="w-full text-sm text-left flex items-center gap-2 whitespace-nowrap" title={file.name}>
                                        <span className="flex-1 truncate font-bold" title={file.name}>
                                            {file.name}
                                        </span>
                                        <span className="flex-shrink-0 text-xs ml-2">
                                            {formatBytes(file.size)}
                                        </span>
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
                <hr className="w-full border-gray-600 mb-2" />
                </>
            )}
            
            <div className="flex flex-1 items-center w-full ">
                <textarea
                    ref={textareaRef}
                    id={textInputId}
                    className="w-full bg-gray-800 max-h-80 text-white px-2 conversations-scroll rounded-md resize-none overflow-y-auto focus:outline-none placeholder-gray-400"
                    placeholder={`${!isNewestBranch ? "You need to be on the right branch to type your request..." : isShareThread ? "You are in a shared thread. You can't type here." : "Type your request..."}`}
                    onInput={onInput}
                    onKeyDown={onKeyDown}
                    disabled={!isNewestBranch || isShareThread}
                    rows={1}
                    style={{ paddingTop: 0, paddingBottom: 0 }}
                />
            </div>
            <div className='flex w-full justify-between mt-2'>
            
                <div className="flex-shrink-0 flex flex-row">
                    <label htmlFor={fileInputId} className="flex items-center justify-center w-10 h-10 hover:bg-gray-600 text-white rounded-md cursor-pointer select-none" title="Add files" aria-label="Add files">
                        <FaPlus className="w-5 h-5" />
                    </label>
                    <input id={fileInputId} type="file" multiple className="hidden" onChange={onFileChange} />
                    <button type="button" className={`flex items-center justify-center w-10 h-10 ${imageGenerationMode ? 'bg-gray-500' : ''} hover:bg-gray-600 text-white rounded-md`} title="Generate image" aria-label="Generate image" onClick={() => setImageGenerationMode(prev => !prev)}>
                        <FaImage className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex-shrink-0 flex items-center 2xl:space-x-2 xl:space-x-2 lg:space-x-2 md:space-x-2">
                    {ttsKeyValid === true ? (
                        <button type="button" className="flex items-center justify-center w-10 h-10  hover:bg-gray-600 text-white rounded-md" title="Record voice" aria-label="Record voice" onClick={onMicClick}>
                            <FaMicrophone className="w-5 h-5" />
                        </button>
                    ) : null}

                    <button type="button" className="flex items-center justify-center px-3 h-10  hover:bg-indigo-500 text-white rounded-md" title="Send message" aria-label="Send message" disabled={!isNewestBranch || isShareThread} onClick={onSendClick}>
                        <FaPaperPlane className="w-5 h-5" />
                    </button>
                </div>
            </div>
            {showAudioModal && <AudioSpectrumModal onClose={() => setShowAudioModal(false)} thread={actualThread} handleAudioSend={handleAudioSend} />}
        </div>
        
    );
}
