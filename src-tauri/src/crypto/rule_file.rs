use crate::error::{AppError, AppResult};
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;

pub const MAGIC: &[u8; 4] = b"LVR1";
pub const FORMAT_VERSION: u8 = 1;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;
pub const KEY_LEN: usize = 32;
pub const ARGON2_M_KIB: u32 = 65_536;
pub const ARGON2_T: u32 = 3;
pub const ARGON2_P: u32 = 1;

pub fn encrypt_with_passphrase(plaintext: &[u8], passphrase: &str) -> AppResult<Vec<u8>> {
    if passphrase.is_empty() {
        return Err(AppError::msg("口令不能为空"));
    }
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce);
    let key = derive_key(passphrase.as_bytes(), &salt, ARGON2_M_KIB, ARGON2_T, ARGON2_P)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| AppError::msg(e.to_string()))?;
    let aad = aad_bytes();
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| AppError::msg("加密失败"))?;

    let mut out = Vec::with_capacity(4 + 1 + 12 + SALT_LEN + NONCE_LEN + ciphertext.len());
    out.extend_from_slice(MAGIC);
    out.push(FORMAT_VERSION);
    out.extend_from_slice(&ARGON2_M_KIB.to_le_bytes());
    out.extend_from_slice(&ARGON2_T.to_le_bytes());
    out.extend_from_slice(&ARGON2_P.to_le_bytes());
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn decrypt_with_passphrase(blob: &[u8], passphrase: &str) -> AppResult<Vec<u8>> {
    if passphrase.is_empty() {
        return Err(AppError::msg("无法解密"));
    }
    let header_len = 4 + 1 + 12 + SALT_LEN + NONCE_LEN;
    if blob.len() < header_len + 16 {
        return Err(AppError::msg("无法解密"));
    }
    if &blob[0..4] != MAGIC {
        return Err(AppError::msg("无法解密"));
    }
    if blob[4] != FORMAT_VERSION {
        return Err(AppError::msg("无法解密"));
    }
    let m = u32::from_le_bytes(blob[5..9].try_into().unwrap());
    let t = u32::from_le_bytes(blob[9..13].try_into().unwrap());
    let p = u32::from_le_bytes(blob[13..17].try_into().unwrap());
    let salt = &blob[17..17 + SALT_LEN];
    let nonce = &blob[17 + SALT_LEN..17 + SALT_LEN + NONCE_LEN];
    let ciphertext = &blob[header_len..];
    let key = derive_key(passphrase.as_bytes(), salt, m, t, p)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| AppError::msg("无法解密"))?;
    let aad = aad_bytes();
    cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| AppError::msg("无法解密"))
}

pub fn encrypt_with_key(plaintext: &[u8], key: &[u8; KEY_LEN]) -> AppResult<Vec<u8>> {
    let mut nonce = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| AppError::msg(e.to_string()))?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_ref())
        .map_err(|_| AppError::msg("加密失败"))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn decrypt_with_key(blob: &[u8], key: &[u8; KEY_LEN]) -> AppResult<Vec<u8>> {
    if blob.len() < NONCE_LEN + 16 {
        return Err(AppError::msg("本地规则解密失败"));
    }
    let (nonce, ct) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| AppError::msg("本地规则解密失败"))?;
    cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| AppError::msg("本地规则解密失败"))
}

fn aad_bytes() -> Vec<u8> {
    let mut aad = Vec::from(MAGIC.as_slice());
    aad.push(FORMAT_VERSION);
    aad
}

fn derive_key(
    passphrase: &[u8],
    salt: &[u8],
    m_kib: u32,
    t: u32,
    p: u32,
) -> AppResult<[u8; KEY_LEN]> {
    let params = Params::new(m_kib, t, p, Some(KEY_LEN))
        .map_err(|e| AppError::msg(format!("Argon2 参数无效: {e}")))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; KEY_LEN];
    argon2
        .hash_password_into(passphrase, salt, &mut key)
        .map_err(|_| AppError::msg("无法解密"))?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_passphrase() {
        let pt = br#"{"id":"demo","name":"d","version":"1"}"#;
        let blob = encrypt_with_passphrase(pt, "secret-pass").unwrap();
        let out = decrypt_with_passphrase(&blob, "secret-pass").unwrap();
        assert_eq!(out, pt);
    }

    #[test]
    fn wrong_passphrase() {
        let blob = encrypt_with_passphrase(b"hello", "right").unwrap();
        let err = decrypt_with_passphrase(&blob, "wrong").unwrap_err().to_string();
        assert_eq!(err, "无法解密");
    }

    #[test]
    fn tampered_byte() {
        let mut blob = encrypt_with_passphrase(b"hello", "right").unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0x01;
        let err = decrypt_with_passphrase(&blob, "right").unwrap_err().to_string();
        assert_eq!(err, "无法解密");
    }
}
