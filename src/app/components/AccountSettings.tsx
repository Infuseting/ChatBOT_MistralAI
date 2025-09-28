import { deleteAccount } from '../utils/Account';
import { useRouter } from 'next/navigation';

/**
 * AccountSettings
 *
 * Simple settings panel for account-related actions. Currently exposes a
 * destructive "delete account" button which calls `deleteAccount()` from
 * `src/app/utils/Account` and then redirects the user to the login page when
 * successful.
 *
 */
export default function AccountSettings() {
    const router = useRouter();
    return (
        <div className='flex flex-col'>
            <div className='px-2 flex flex-col'>
                <h4 className="text-lg font-medium mb-2">Account</h4>
                <p className="text-md text-gray-300">Account-related settings (email, profile, etc.).</p>
            </div>
            <div className="h-0.5 w-full bg-gray-700 my-2"></div>
            <div className='px-2 flex flex-col mt-4'>
                <div className='flex flex-row justify-between'>
                    <span>Supprimer le compte</span>
                    <button onClick={async () => {if (await deleteAccount()) router.push('/login')}} className='bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded'>Supprimer</button>
                </div>
                <div className='text-[0.70rem] text-gray-400 mt-1'>
                    Cette action est irréversible. Toutes vos données seront perdues.
                </div>                
            </div>
        </div>
    );
}
