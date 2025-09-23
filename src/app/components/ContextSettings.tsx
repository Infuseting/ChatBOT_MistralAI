import { getContext, setContext } from "../utils/Context";
import { useState, useEffect } from "react";
export default function ContextSettings() {
    const [text, setText] = useState<string>('');
    
    useEffect(() => {
        const context = getContext();
        setText(context ?? '');
    }, []);

    function saveContext(value?: string) {
        if (typeof value === 'string') {
            setContext(value);
        } else {
            setContext(text);
        }
    }

    return (
        <div className='flex flex-col'>
            <div className='px-2 flex flex-col'>
                <h4 className="text-lg font-medium mb-2">Context</h4>
                <p className="text-md text-gray-300">Context-related settings (Format Return, Context, etc.).</p>
            </div>
            <div className="h-0.5 w-full bg-gray-700 my-2"></div>
            <div className='px-2 flex flex-col mt-4'>
                <textarea
                    onChange={(e) => {
                        const v = e.target.value;
                        setText(v);
                        saveContext(v);
                    }}
                    value={text}
                    placeholder="Provide context to the IA to help it answer better. For example, you can provide information about your company, products, or specific instructions on how you want the IA to respond."
                    className="flex-1 w-full min-h-0 p-2 bg-gray-900 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none overflow-auto box-border"
                />                              
            </div>
        </div>
    );
}
