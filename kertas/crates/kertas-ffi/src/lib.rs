//! ABI: the host passes a NUL-terminated JSON request to `kertas_ffi_call`
//! and gets a NUL-terminated JSON answer it must release with
//! `kertas_ffi_free`. The answer is the same `{"ok":…}` or `{"error":…}`
//! as the wasm module's, so every host shares one request format.

use std::ffi::{CStr, CString, c_char};

fn answer(request: &[u8]) -> CString {
    let json = kertas::handle_json(request);
    CString::new(json).unwrap_or_else(|_| c"{\"error\":\"answer held a NUL byte\"}".to_owned())
}

/// # Safety
/// `request` must be null or a valid NUL-terminated string that stays alive
/// for the duration of the call.
#[unsafe(no_mangle)]
#[allow(unsafe_code)]
pub unsafe extern "C" fn kertas_ffi_call(request: *const c_char) -> *mut c_char {
    let bytes: &[u8] = if request.is_null() {
        &[]
    } else {
        // SAFETY: the caller upholds that `request` is a live C string.
        unsafe { CStr::from_ptr(request) }.to_bytes()
    };
    answer(bytes).into_raw()
}

/// # Safety
/// `answer` must be null or a pointer returned by `kertas_ffi_call`, released
/// once.
#[unsafe(no_mangle)]
#[allow(unsafe_code)]
pub unsafe extern "C" fn kertas_ffi_free(answer: *mut c_char) {
    if !answer.is_null() {
        // SAFETY: the caller upholds that `answer` came from `kertas_ffi_call`.
        drop(unsafe { CString::from_raw(answer) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[allow(unsafe_code)]
    fn round_trips_through_the_c_abi() {
        let request = c"{\"op\":\"normalize\",\"text\":\"Salut!\"}";
        // SAFETY: drives the ABI exactly as a native host would.
        let text = unsafe {
            let out = kertas_ffi_call(request.as_ptr());
            let text = CStr::from_ptr(out).to_string_lossy().into_owned();
            kertas_ffi_free(out);
            text
        };
        assert!(text.starts_with(r#"{"ok":"#), "{text}");
    }
}
