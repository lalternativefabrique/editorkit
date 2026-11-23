//! ABI: the host writes a JSON request into a buffer from `kertas_alloc(len)`
//! and calls `kertas_call(ptr, len)`. The answer buffer starts with its JSON
//! length as a little-endian u32, followed by the JSON. The host frees the
//! request with `kertas_free(ptr, len)` and the answer with
//! `kertas_free(answer, 4 + json_len)`. The module has no imports, so a
//! browser and wazero load the same file.

use std::alloc::{Layout, alloc, dealloc};
use std::ptr::NonNull;

const LENGTH_PREFIX: usize = 4;

fn layout(len: usize) -> Option<Layout> {
    Layout::array::<u8>(len).ok().filter(|l| l.size() > 0)
}

#[unsafe(no_mangle)]
#[allow(unsafe_code)]
pub extern "C" fn kertas_alloc(len: usize) -> *mut u8 {
    match layout(len) {
        // SAFETY: the layout has a non-zero size, which is all `alloc` requires.
        Some(layout) => unsafe { alloc(layout) },
        None => NonNull::dangling().as_ptr(),
    }
}

/// # Safety
/// `ptr` must come from `kertas_alloc(len)`, or be an answer of `kertas_call`
/// freed with its full length, and must not be used afterwards.
#[unsafe(no_mangle)]
#[allow(unsafe_code)]
pub unsafe extern "C" fn kertas_free(ptr: *mut u8, len: usize) {
    if let Some(layout) = layout(len) {
        // SAFETY: the caller upholds that `ptr` was allocated with this layout.
        unsafe { dealloc(ptr, layout) }
    }
}

/// # Safety
/// `ptr..ptr + len` must be an initialised buffer from `kertas_alloc(len)`.
#[unsafe(no_mangle)]
#[allow(unsafe_code)]
pub unsafe extern "C" fn kertas_call(ptr: *const u8, len: usize) -> *mut u8 {
    let input: &[u8] = if len == 0 {
        &[]
    } else {
        // SAFETY: the caller upholds that the buffer is live and initialised.
        unsafe { std::slice::from_raw_parts(ptr, len) }
    };
    let json = kertas::handle_json(input).into_bytes();
    let Ok(json_len) = u32::try_from(json.len()) else {
        return std::ptr::null_mut();
    };
    let out = kertas_alloc(LENGTH_PREFIX + json.len());
    if out.is_null() {
        return out;
    }
    // SAFETY: `out` was just allocated for the prefix plus the JSON and
    // cannot overlap either source.
    unsafe {
        std::ptr::copy_nonoverlapping(json_len.to_le_bytes().as_ptr(), out, LENGTH_PREFIX);
        std::ptr::copy_nonoverlapping(json.as_ptr(), out.add(LENGTH_PREFIX), json.len());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[allow(unsafe_code)]
    fn round_trips_through_the_abi() {
        let request = br#"{"op":"normalize","text":"Salut!"}"#;
        let input = kertas_alloc(request.len());
        // SAFETY: drives the ABI exactly as a host would.
        let answer = unsafe {
            std::ptr::copy_nonoverlapping(request.as_ptr(), input, request.len());
            let out = kertas_call(input, request.len());
            kertas_free(input, request.len());
            let mut prefix = [0u8; LENGTH_PREFIX];
            std::ptr::copy_nonoverlapping(out, prefix.as_mut_ptr(), LENGTH_PREFIX);
            let len = u32::from_le_bytes(prefix) as usize;
            let text =
                String::from_utf8_lossy(std::slice::from_raw_parts(out.add(LENGTH_PREFIX), len))
                    .into_owned();
            kertas_free(out, LENGTH_PREFIX + len);
            text
        };
        assert!(answer.starts_with(r#"{"ok":"#), "{answer}");
    }
}
