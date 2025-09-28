/**
 * Toast helpers
 *
 * Small wrappers around `react-toastify` to provide consistent styling for
 * success and error toasts across the application.
 */
import { toast, Bounce } from "react-toastify";

export function showErrorToast(message: string) {
    toast.error(message, {
        position: "bottom-right",
        autoClose: 5000,
        hideProgressBar: false,
        closeOnClick: false,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
        theme: "dark",
        transition: Bounce,
    });
}

export function showSuccessToast(message: string) {
    toast.success(message, {
            position: "bottom-right",
            autoClose: 5000,
            hideProgressBar: false,
            closeOnClick: false,
            pauseOnHover: true,
            draggable: true,
            progress: undefined,
            theme: "dark",
            transition: Bounce,
    });
}