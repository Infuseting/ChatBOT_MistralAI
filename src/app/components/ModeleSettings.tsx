"use client";

import { useEffect } from 'react';
import { getApiKey, setApiKey, isValidApiKey } from '../utils/ApiKey';
import { getAvailableModelList, getFastModelList, toggleFastModel, isFastModel, getActualModel, setActualModel } from '../utils/Models';
import { useState } from 'react';
export default function ModeleSettings() {
    const [apiKey, setApiKeyState] = useState('');
    const [isApiKeyValid, setIsApiKeyValid] = useState<"true" | "false" | undefined>(undefined);
    const [modelList, setModelList] = useState<any[]>([]);
    const [fastModelList, setFastModelList] = useState<string[]>([]);
    useEffect(() => {
        const init = async () => {
            const key = getApiKey() ?? '';
            setApiKeyState(key);
            setFastModelList(getFastModelList());
            const valid = key ? await isValidApiKey(key) : undefined;
            setIsApiKeyValid(valid ? "true" : valid === false ? "false" : undefined);
            if (valid) {
                const models = await getAvailableModelList();
                setModelList(models);
            }
        };
        init();
    }, []);

    const handleApiKeyChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const newKey = event.target.value;
        setApiKeyState(newKey);
        setApiKey(newKey);
        setIsApiKeyValid(undefined);
    };

    const handleApiKeyBlur = async () => {
        const key = apiKey;
        if (!key) {
            setIsApiKeyValid(undefined);
            return;
        }
        const valid = await isValidApiKey(key);
        const modelList = await getAvailableModelList();
        console.log("Fetched model list:", modelList);
        setModelList(modelList);
        setIsApiKeyValid(valid ? "true" : "false");
    };
    const handleToggleFastModelAppend = (model: string) => {
        toggleFastModel(model);
        setFastModelList(getFastModelList());
        
        console.log("Fast model list updated:", getFastModelList());
    }
    return (
        <div className='flex flex-col'>
            <div className='px-2 flex flex-col'>
                <h4 className="text-lg font-medium mb-2">Modele</h4>
                <p className="text-md text-gray-300">Modele-related settings (API-Key, Fast-Model, etc.).</p>
            </div>
            <div className="h-0.5 w-full bg-gray-700 my-2"></div>
            <div className='px-2 flex flex-col mt-4'>
                <div className='space-y-1'>
                    <p><a target="_blank" rel="noopener noreferrer" href="https://www.merge.dev/blog/mistral-ai-api-key">Mistral API-KEY </a> (API-KEY is saved in local storage)</p>
                    <input
                        value={apiKey}
                        onChange={handleApiKeyChange}
                        onBlur={handleApiKeyBlur}
                        type="text"
                        className={`mt-1 p-2 rounded bg-gray-700 text-white w-full border ${isApiKeyValid === "true" ? "border-green-500 focus:border-green-500 focus:ring-2 focus:ring-green-500" : isApiKeyValid === "false" ? "border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-500" : "border-orange-500 focus:border-orange-500 focus:ring-2 focus:ring-orange-500"} focus:outline-none`}
                        placeholder='Enter your Mistral API Key here'
                    />
                </div>
                <div className='mt-4'>
                    <select className='w-full p-2 rounded bg-gray-700 text-white border border-gray-600' onChange={(e) => { const model = e.target.value; setActualModel(model); }} >
                        {fastModelList.map((model) => (
                            <option key={model} value={model} selected={model === getActualModel()}>
                                {model}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="mt-4">
                    Models available with your API key:
                    <ul className="list-disc list-inside mt-2 text-sm text-gray-300">
                        {modelList.length === 0 ? (
                            <li className="text-sm text-gray-500">{isApiKeyValid === "true" ? "No models found" : isApiKeyValid === "false" ? "Invalid API key" : "Checking API key..."}</li>
                        ) : (
                            modelList.map((model, idx) => (
                                <li className="list-none" key={`${model}-${idx}`}>
                                    <div
                                        onClick={() => handleToggleFastModelAppend(model.id)}
                                        className={`rounded-md border border-gray-600 p-2 mb-2 cursor-pointer ${isFastModel(model.id) ? "bg-blue-600" : "bg-gray-700"}`}
                                    >
                                        <h1 className="text-lg">{model.id}</h1>
                                        <p className="text-sm">{model.description}</p>
                                    </div>
                                </li>
                            ))
                        )}
                    </ul>                     
                </div>           
            </div>
        </div>
    );
}
