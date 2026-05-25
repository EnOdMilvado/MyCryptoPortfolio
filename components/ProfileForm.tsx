"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Avatar } from "./Avatar";
import { MfaSection } from "./MfaSection";

interface Props {
  userId: string;
  email: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  hasMfa: boolean;
}

export function ProfileForm({
  userId,
  email,
  displayName: initialName,
  bio: initialBio,
  avatarUrl: initialAvatar,
  hasMfa,
}: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialName ?? "");
  const [bio, setBio] = useState(initialBio ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatar);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase
      .from("crypto_profiles")
      .update({
        display_name: displayName.trim() || null,
        bio: bio.trim() || null,
      })
      .eq("id", userId);
    setSaving(false);
    if (error) {
      setSaveMsg(`Failed: ${error.message}`);
      return;
    }
    setSaveMsg("Saved ✓");
    router.refresh();
    setTimeout(() => setSaveMsg(null), 2000);
  }

  async function uploadAvatar(file: File) {
    setUploadError(null);
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Image must be under 5 MB.");
      return;
    }
    const supabase = supabaseBrowser();
    const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
    const filename = `${userId}/avatar-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("crypto-avatars")
      .upload(filename, file, { upsert: true, contentType: file.type });
    if (upErr) {
      setUploadError(upErr.message);
      return;
    }
    const { data: pub } = supabase.storage
      .from("crypto-avatars")
      .getPublicUrl(filename);
    const url = pub.publicUrl;
    setAvatarUrl(url);
    await supabase
      .from("crypto_profiles")
      .update({ avatar_url: url })
      .eq("id", userId);
    router.refresh();
  }

  async function removeAvatar() {
    if (!avatarUrl) return;
    if (!confirm("Remove your profile picture?")) return;
    const supabase = supabaseBrowser();
    await supabase
      .from("crypto_profiles")
      .update({ avatar_url: null })
      .eq("id", userId);
    setAvatarUrl(null);
    router.refresh();
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    setPwErr(null);
    if (newPw.length < 6) {
      setPwErr("Password must be at least 6 characters.");
      return;
    }
    if (newPw !== newPw2) {
      setPwErr("Passwords don't match.");
      return;
    }
    setPwSaving(true);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.updateUser({ password: newPw });
    setPwSaving(false);
    if (error) {
      setPwErr(error.message);
      return;
    }
    setPwMsg("Password updated ✓");
    setNewPw("");
    setNewPw2("");
    setTimeout(() => setPwMsg(null), 3000);
  }

  return (
    <div className="space-y-6">
      {/* ===== Identity ===== */}
      <form onSubmit={saveProfile} className="card space-y-5">
        <div>
          <h2 className="text-lg font-bold text-text">Profile</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Display name + bio are visible only to you and the admin. The email is
            tied to your login and can&apos;t be changed here.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <Avatar url={avatarUrl} name={displayName} email={email} size={64} />
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="btn-ghost text-sm"
            >
              Upload picture
            </button>
            {avatarUrl && (
              <button
                type="button"
                onClick={removeAvatar}
                className="block text-xs text-danger hover:text-danger/80"
              >
                Remove picture
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAvatar(f);
                e.target.value = "";
              }}
            />
            {uploadError && (
              <p className="text-xs text-danger">{uploadError}</p>
            )}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            disabled
          />
        </div>

        <div>
          <label className="label" htmlFor="display_name">Display name</label>
          <input
            id="display_name"
            className="input"
            placeholder="e.g. Or Matityahu"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={60}
          />
        </div>

        <div>
          <label className="label" htmlFor="bio">Bio (optional)</label>
          <textarea
            id="bio"
            className="input min-h-[80px]"
            placeholder="A line about you (optional)"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={300}
          />
          <p className="mt-1 text-xs text-text-muted">{bio.length} / 300</p>
        </div>

        <div className="flex items-center justify-end gap-3">
          {saveMsg && (
            <span className={`text-sm ${saveMsg.startsWith("Failed") ? "text-danger" : "text-success"}`}>
              {saveMsg}
            </span>
          )}
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>

      {/* ===== Password ===== */}
      <form onSubmit={changePassword} className="card space-y-4">
        <div>
          <h2 className="text-lg font-bold text-text">Change password</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Sets a new password. You stay signed in on this device.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="new_pw">New password</label>
            <input
              id="new_pw"
              type="password"
              className="input"
              autoComplete="new-password"
              minLength={6}
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="new_pw2">Confirm password</label>
            <input
              id="new_pw2"
              type="password"
              className="input"
              autoComplete="new-password"
              minLength={6}
              value={newPw2}
              onChange={(e) => setNewPw2(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3">
          {pwErr && <span className="text-sm text-danger">{pwErr}</span>}
          {pwMsg && <span className="text-sm text-success">{pwMsg}</span>}
          <button type="submit" disabled={pwSaving} className="btn-primary">
            {pwSaving ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>

      {/* ===== 2FA ===== */}
      <MfaSection initiallyEnrolled={hasMfa} />
    </div>
  );
}
