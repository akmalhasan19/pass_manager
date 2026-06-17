# QA Checklist: SecurePass Manager — Release Build

> Checklist ini harus dilalui sepenuhnya sebelum setiap rilis yang berisi perubahan pada fitur multi-vault, auth, database, atau UI kritis. Setiap item harus dicentang oleh QA engineer dan disertai catatan jika ada anomaly.

---

## Environment Information

| Field | Value |
|-------|-------|
| Versi Aplikasi | ___________________ |
| Platform | ☐ Windows ☐ macOS ☐ Linux |
| Build Type | ☐ Development ☐ Staging ☐ Production |
| Tester | ___________________ |
| Tanggal | ___________________ |

---

## 1. Lock Screen & Vault Selector

### 1.1 Setup Flow (Pertama Kali Buka)

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 1.1.1 | Fresh install, tidak ada vault | Buka aplikasi | Tampil setup screen dengan form master password | ☐ |
| 1.1.2 | Fresh install, buat vault pertama | Masukkan password kuat → klik Create | Vault "Default Vault" terbuat, langsung unlocked | ☐ |
| 1.1.3 | Setup dengan password lemah | Masukkan password lemah (e.g. "1234") | Error: "Master password too weak", tidak membuat vault | ☐ |
| 1.1.4 | Setup dengan password kosong | Klik Create tanpa password | Error validasi, vault tidak terbuat | ☐ |

### 1.2 Lock Screen dengan Vault yang Ada

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 1.2.1 | Lock screen dengan 1 vault | Lock aplikasi | Tampil lock screen, vault selector menampilkan 1 vault | ☐ |
| 1.2.2 | Lock screen dengan banyak vault | Lock aplikasi | Tampil lock screen, vault selector menampilkan semua vault dengan urutan sortOrder | ☐ |
| 1.2.3 | Unlock vault yang dipilih | Pilih vault X → masukkan password benar | Vault X terbuka, halaman main app muncul | ☐ |
| 1.2.4 | Unlock dengan password salah | Pilih vault X → masukkan password salah | Error "Invalid master password", tetap di lock screen | ☐ |
| 1.2.5 | Pilih vault lain sebelum unlock | Klik vault Y di selector | Vault Y menjadi target unlock, label UI update | ☐ |
| 1.2.6 | Unlock vault tanpa auth metadata | Pilih vault yang auth file-nya dihapus manual | Error "Auth metadata not found", tetap di lock screen | ☐ |

### 1.3 Create Vault dari Lock Screen

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 1.3.1 | Create vault valid | Lock screen → klik Create Vault → isi nama & password | Vault baru terbuat, langsung unlocked | ☐ |
| 1.3.2 | Create vault dengan nama duplikat | Coba nama yang sudah ada (case-insensitive) | Error "A vault with the name ... already exists" | ☐ |
| 1.3.3 | Create vault dengan nama > 100 karakter | Isi nama 101 karakter | Error nama terlalu panjang | ☐ |
| 1.3.4 | Create vault dengan nama kosong | Kosongkan nama | Error nama wajib diisi | ☐ |
| 1.3.5 | Create vault dengan nama `.` atau `..` | Isi nama `.` | Error nama tidak valid | ☐ |
| 1.3.6 | Create vault dengan karakter kontrol | Paste nama dengan `\x00` atau `\t` | Error nama tidak valid | ☐ |

### 1.4 Import Vault dari Lock Screen

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 1.4.1 | Import file .db valid | Lock screen → Import → pilih file .db → isi nama | Vault muncul di list, tidak auto-unlock | ☐ |
| 1.4.2 | Import file bukan database | Pilih file .txt | Error "Invalid file type" | ☐ |
| 1.4.3 | Import dengan nama duplikat | Isi nama yang sudah ada | Error duplikat nama | ☐ |
| 1.4.4 | Import file dengan path traversal di nama | Coba nama `../evil` | Error nama tidak valid | ☐ |

---

## 2. Main App & Vault Switching

### 2.1 Vault Switcher di Main App

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 2.1.1 | Tampil nama vault aktif | Unlock vault "Work" | Sidebar/title menampilkan "Work" | ☐ |
| 2.1.2 | Switch ke vault lain | Klik vault switcher → pilih "Personal" → masukkan password | Lock screen muncul, vault "Personal" dihighlight | ☐ |
| 2.1.3 | Konfirmasi switch vault | Saat pilih vault lain | Dialog konfirmasi: "Current vault will be locked" | ☐ |
| 2.1.4 | Cancel switch vault | Klik Cancel di dialog konfirmasi | Tetap di vault aktif, tidak ada perubahan | ☐ |
| 2.1.5 | Switch dengan password salah | Klik Confirm → password salah | Tetap di lock screen, error muncul | ☐ |
| 2.1.6 | Switch dengan password benar | Klik Confirm → password benar | Vault baru terbuka, data vault baru muncul | ☐ |

### 2.2 Data Isolation Saat Switch

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 2.2.1 | Item tidak bocor antar vault | Vault A punya item "Bank", switch ke Vault B | Vault B tidak menampilkan item "Bank" | ☐ |
| 2.2.2 | Folder tidak bocor antar vault | Vault A punya folder "Finance", switch ke Vault B | Vault B tidak punya folder "Finance" | ☐ |
| 2.2.3 | Search result bersih setelah switch | Cari "Bank" di Vault A → switch ke Vault B | Search result kosong (atau default view) | ☐ |
| 2.2.4 | Selected item/ folder direset | Pilih item di Vault A → switch ke Vault B | Tidak ada item yang terpilih | ☐ |
| 2.2.5 | Settings tersimpan per vault | Ubah setting di Vault A → switch ke Vault B → kembali ke Vault A | Setting Vault A tetap sama | ☐ |

---

## 3. Vault Management Dialog

### 3.1 Rename Vault

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 3.1.1 | Rename vault valid | Management dialog → Rename → isi nama baru | Nama update di registry dan UI | ☐ |
| 3.1.2 | Rename ke duplikat | Isi nama yang sudah dipakai vault lain | Error duplikat | ☐ |
| 3.1.3 | Rename vault yang sedang aktif | Rename vault yang sedang terbuka | Nama update di lock screen dan main app | ☐ |

### 3.2 Set Default Vault

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 3.2.1 | Set default vault | Pilih vault X → Set as Default | Vault X muncul pertama di lock screen selector | ☐ |
| 3.2.2 | Hanya satu default | Set vault Y sebagai default | Vault X tidak lagi default | ☐ |

### 3.3 Delete Vault

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 3.3.1 | Delete vault yang tidak aktif | Pilih vault lain → delete vault X | Konfirmasi dengan nama vault | ☐ |
| 3.3.2 | Cancel delete | Klik Cancel di konfirmasi delete | Vault tetap ada | ☐ |
| 3.3.3 | Delete vault yang aktif | Delete vault yang sedang terbuka | Vault terkunci dulu, lalu dihapus. Kembali ke lock screen | ☐ |
| 3.3.4 | Delete tanpa hapus file | Uncheck "Delete database file" | Entry dihapus dari registry, file .db tetap ada di disk | ☐ |
| 3.3.5 | Delete dengan hapus attachment | Check "Delete attachments" | Folder attachments/{vaultId} juga terhapus | ☐ |
| 3.3.6 | Konfirmasi nama salah | Ketik nama yang berbeda saat konfirmasi delete | Error konfirmasi nama tidak cocok | ☐ |

### 3.4 Reveal File Location

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 3.4.1 | Reveal vault location | Klik "Reveal in Finder/Explorer" | File manager OS terbuka di folder vault | ☐ |

---

## 4. Backup & Restore

### 4.1 Backup Vault

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 4.1.1 | Backup vault aktif | Settings → Backup Vault → pilih lokasi save | File `.spmv` tersimpan | ☐ |
| 4.1.2 | Konten backup terenkripsi | Buka file .spmv dengan text editor | Database dalam bentuk base64, tidak ada plaintext password | ☐ |
| 4.1.3 | Backup menyertakan auth metadata | Parse file .spmv | Terdapat salt, KDF params, verificationHash | ☐ |
| 4.1.4 | Cancel backup dialog | Klik Cancel di save dialog | Tidak ada file yang tersimpan | ☐ |

### 4.2 Restore Vault

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 4.2.1 | Restore dari backup valid | Import → pilih .spmv → isi nama baru | Vault muncul di list | ☐ |
| 4.2.2 | Restore dengan nama yang sama | Isi nama yang sudah ada | Error duplikat atau prompt rename | ☐ |
| 4.2.3 | Restore file yang dimodifikasi | Ubah isi .spmv secara manual | Error "Invalid backup file" saat parse | ☐ |
| 4.2.4 | Restore bukan file .spmv | Pilih file .txt | Error "Invalid file type" | ☐ |
| 4.2.5 | Restore file dengan magic salah | Ubah magic di .spmv | Error magic mismatch | ☐ |
| 4.2.6 | Vault yang direstore bisa di-unlock | Restore → unlock dengan password dari backup asli | Berhasil terbuka, data lengkap | ☐ |

---

## 5. Auto-Lock Behavior

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 5.1 | Auto-lock timer | Set auto-lock 30 detik → tunggu tanpa aktivitas | Vault terkunci otomatis setelah 30 detik | ☐ |
| 5.2 | Warning sebelum lock | Set auto-lock 1 menit → tunggu 30 detik | Toast/overlay warning muncul "Locking in 30s" | ☐ |
| 5.3 | Extend timer | Klik "Extend" saat warning muncul | Timer reset, tidak lock | ☐ |
| 5.4 | Aktivitas reset timer | Gerakkan mouse saat countdown | Timer reset | ☐ |
| 5.5 | Auto-lock saat switch vault | Switch vault, tunggu auto-lock timeout | Timer reset untuk vault baru, tidak membawa idle time vault lama | ☐ |
| 5.6 | Lock saat app minimize/minimize to tray | Minimize aplikasi | Vault tetap terbuka (atau lock tergantung setting) | ☐ |
| 5.7 | Lock saat OS lock/suspend | Lock screen OS / tutup laptop | Vault terkunci | ☐ |

---

## 6. Import / Export Data (Vault-Scoped)

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 6.1 | Import masuk ke vault aktif | Unlock vault A → Import CSV | Semua item masuk ke vault A | ☐ |
| 6.2 | Export hanya vault aktif | Unlock vault A → Export JSON | Hanya item vault A yang diekspor | ☐ |
| 6.3 | Duplicate detection scoped | Import item yang sama ke vault B (berbeda dari A) | Dianggap tidak duplikat (DB vault B kosong) | ☐ |
| 6.4 | Plain text export warning | Export ke CSV | Warning menyebut nama vault: "You are exporting data from vault [Name]" | ☐ |
| 6.5 | Import tanpa vault aktif | Lock aplikasi → coba Import | Error "No vault is currently active" | ☐ |

---

## 7. Security & Isolation

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 7.1 | Key material vault lama terwipe | Switch vault → unlock vault baru | Tidak ada cara untuk decrypt data vault lama tanpa re-unlock | ☐ |
| 7.2 | DB connection tertutup saat switch | Switch vault → coba query via dev tools (jika ada) | Query gagal karena DB tidak terbuka | ☐ |
| 7.3 | Memory wipe saat lock | Lock aplikasi | Task manager tidak menunjukkan anomali memory retain | ☐ |
| 7.4 | Path traversal pada attachment | Coba path `../../etc/passwd` saat attach file | Error "path traversal detected" | ☐ |
| 7.5 | SQL injection pada search | Search dengan `' OR 1=1 --` | Tidak menampilkan semua item (parameterized) | ☐ |
| 7.6 | XSS pada nama vault | Buat vault dengan nama `<script>alert(1)</script>` | Nama ditampilkan sebagai text, bukan dieksekusi | ☐ |
| 7.7 | Unicode normalization nama vault | Buat vault dengan nama "Café" lalu coba "Cafe\u0301" | Dianggap duplikat (NFC normalization) | ☐ |

---

## 8. Failure Recovery

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 8.1 | Registry corrupted | Hapus bagian JSON vault-registry.json | Aplikasi detect error, tawarkan recovery scan | ☐ |
| 8.2 | Recovery scan menemukan vault | Klik "Recover Vaults" dari error screen | List vault yang bisa direcover muncul | ☐ |
| 8.3 | Commit recovery | Pilih vault → Commit recovery | Vault muncul kembali di registry | ☐ |
| 8.4 | Vault file hilang | Hapus file .db vault X manual | Status vault X di UI: "missing" | ☐ |
| 8.5 | Remove missing vaults | Klik "Remove Missing Vaults" | Entry vault yang file-nya hilang dihapus dari registry | ☐ |
| 8.6 | Registry rollback | Corrupt registry, lakukan recovery yang gagal | Registry dikembalikan ke backup sebelum recovery | ☐ |

---

## 9. Localization & Accessibility

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 9.1 | i18n Bahasa Indonesia | Switch ke Bahasa Indonesia | Semua label vault dalam Bahasa Indonesia | ☐ |
| 9.2 | i18n Bahasa Inggris | Switch ke Bahasa Inggris | Semua label vault dalam Bahasa Inggris | ☐ |
| 9.3 | Keyboard navigation vault selector | Lock screen → Tab/Arrow keys | Bisa pilih vault tanpa mouse | ☐ |
| 9.4 | Focus trap confirm dialog | Buka delete vault confirm → tekan Tab | Focus tetap di dalam dialog | ☐ |
| 9.5 | Focus return setelah dialog | Tutup confirm dialog | Focus kembali ke tombol yang membuka dialog | ☐ |
| 9.6 | Aria-live untuk status switch | Switch vault | Screen reader mengumumkan status | ☐ |

---

## 10. Backward Compatibility

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 10.1 | Buka aplikasi lama (single-vault) | Install versi lama → buat vault → upgrade ke versi multi-vault | Vault lama muncul sebagai "Default Vault" di registry | ☐ |
| 10.2 | Data lama tetap bisa di-unlock | Unlock "Default Vault" dengan password lama | Data lengkap, tidak ada kehilangan | ☐ |
| 10.3 | Auth lama dimigrasi | Cek direktori vault-auth | Terdapat file .auth.json untuk vault migrasi | ☐ |
| 10.4 | Marker migrasi ditulis | Cek userData | File `single-vault-migration.marker.json` ada | ☐ |
| 10.5 | Tidak dobel migrasi | Buka aplikasi lagi setelah migrasi | Tidak membuat vault duplikat | ☐ |

---

## 11. Performance & Edge Cases

| # | Skenario | Langkah | Ekspektasi | Status |
|---|----------|---------|------------|--------|
| 11.1 | Membuat 50 vault | Script/ manual buat 50 vault | Semua muncul di list, tidak crash | ☐ |
| 11.2 | Switch cepat antar vault | Switch A → B → A dalam waktu singkat | Tidak race condition, vault terakhir yang valid terbuka | ☐ |
| 11.3 | Delete vault sambil operasi berjalan | Mulai export besar → delete vault | Operasi dibatalkan, vault terkunci dan terhapus | ☐ |
| 11.4 | Buka dengan vault yang corrupted | Corrupt file .db dengan text editor | Error "Database corrupted", tawarkan repair | ☐ |
| 11.5 | Repair corrupted DB | Klik repair pada vault corrupted | DB dibuat baru (data hilang tapi vault bisa digunakan) | ☐ |

---

## Summary

| Kategori | Total | Berhasil | Gagal | N/A |
|----------|-------|----------|-------|-----|
| Lock Screen & Vault Selector | 10 | ___ | ___ | ___ |
| Main App & Vault Switching | 7 | ___ | ___ | ___ |
| Vault Management Dialog | 11 | ___ | ___ | ___ |
| Backup & Restore | 10 | ___ | ___ | ___ |
| Auto-Lock Behavior | 7 | ___ | ___ | ___ |
| Import / Export (Vault-Scoped) | 5 | ___ | ___ | ___ |
| Security & Isolation | 7 | ___ | ___ | ___ |
| Failure Recovery | 6 | ___ | ___ | ___ |
| Localization & Accessibility | 6 | ___ | ___ | ___ |
| Backward Compatibility | 5 | ___ | ___ | ___ |
| Performance & Edge Cases | 5 | ___ | ___ | ___ |
| **TOTAL** | **79** | **___** | **___** | **___** |

### Sign-off

| Role | Nama | Tanggal | Tanda Tangan / Approval |
|------|------|---------|-------------------------|
| QA Engineer | | | |
| Lead Developer | | | |
| Release Manager | | | |

---

## Catatan Anomaly / Known Issues

> Tempat untuk mencatat bug yang ditemukan selama QA dan keputusan yang diambil.

1. ________________________________________________________________
2. ________________________________________________________________
3. ________________________________________________________________
