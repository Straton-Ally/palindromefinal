/**
 * "•••" button that opens a sheet to report or block another player.
 * Works on iOS, Android and web (plain Modal, no native action sheet).
 */

import { useThemeContext } from '@/context/ThemeContext';
import { blockPlayer, PlayerSummary, REPORT_REASONS, ReportReason, reportPlayer } from '@/lib/moderation';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';

type Step = 'menu' | 'reasons' | 'details' | 'reported' | 'confirmBlock' | 'blocked';

export function PlayerActionsButton({
  player,
  onBlocked,
  color,
  size = 20,
}: {
  player: PlayerSummary;
  /** Called after the player is blocked so the caller can drop them from its list. */
  onBlocked?: (playerId: string) => void;
  color?: string;
  size?: number;
}) {
  const { theme } = useThemeContext();
  const isDark = theme === 'dark';
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={10}
        style={({ pressed }) => [styles.trigger, { opacity: pressed ? 0.6 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel={`More options for ${player.name}: report or block`}
      >
        <Ionicons
          name="ellipsis-horizontal"
          size={size}
          color={color ?? (isDark ? 'rgba(255,255,255,0.75)' : 'rgba(17,17,17,0.6)')}
        />
      </Pressable>
      {open ? (
        <PlayerActionsSheet player={player} onClose={() => setOpen(false)} onBlocked={onBlocked} />
      ) : null}
    </>
  );
}

function PlayerActionsSheet({
  player,
  onClose,
  onBlocked,
}: {
  player: PlayerSummary;
  onClose: () => void;
  onBlocked?: (playerId: string) => void;
}) {
  const { theme } = useThemeContext();
  const isDark = theme === 'dark';
  const [step, setStep] = useState<Step>('menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [blockedNow, setBlockedNow] = useState(false);

  const bg = isDark ? '#14143a' : '#FFFFFF';
  const text = isDark ? '#FFFFFF' : '#111111';
  const muted = isDark ? 'rgba(255,255,255,0.65)' : 'rgba(17,17,17,0.6)';
  const divider = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  const danger = '#E5484D';
  const accent = '#0060FF';

  const close = () => {
    if (busy) return;
    if (blockedNow) onBlocked?.(player.id);
    onClose();
  };

  const submitReport = async (reason: ReportReason, extra?: string) => {
    setBusy(true);
    setError(null);
    try {
      await reportPlayer(player, reason, extra);
      setStep('reported');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doBlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await blockPlayer(player.id);
      setBlockedNow(true);
      setStep('blocked');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const Option = ({
    icon,
    label,
    onPress,
    destructive,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    destructive?: boolean;
  }) => (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.option,
        { borderBottomColor: divider, backgroundColor: pressed ? divider : 'transparent' },
      ]}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={20} color={destructive ? danger : text} />
      <Text style={[styles.optionText, { color: destructive ? danger : text }]}>{label}</Text>
    </Pressable>
  );

  const PrimaryButton = ({ label, onPress, color }: { label: string; onPress: () => void; color: string }) => (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.primaryBtn, { backgroundColor: color, opacity: busy ? 0.6 : pressed ? 0.85 : 1 }]}
      accessibilityRole="button"
    >
      {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.primaryBtnText}>{label}</Text>}
    </Pressable>
  );

  let title = player.name;
  let body: React.ReactNode = null;

  if (step === 'menu') {
    body = (
      <>
        <Option icon="flag-outline" label="Report player" onPress={() => setStep('reasons')} />
        <Option icon="ban-outline" label="Block player" destructive onPress={() => setStep('confirmBlock')} />
      </>
    );
  } else if (step === 'reasons') {
    title = `Report ${player.name}`;
    body = (
      <>
        <Text style={[styles.message, { color: muted }]}>Why are you reporting this player?</Text>
        {REPORT_REASONS.map((r) => (
          <Option
            key={r.value}
            icon="chevron-forward"
            label={r.label}
            onPress={() => (r.value === 'other' ? setStep('details') : void submitReport(r.value))}
          />
        ))}
      </>
    );
  } else if (step === 'details') {
    title = `Report ${player.name}`;
    body = (
      <>
        <Text style={[styles.message, { color: muted }]}>Tell us what happened.</Text>
        <TextInput
          value={details}
          onChangeText={setDetails}
          placeholder="Describe the problem"
          placeholderTextColor={muted}
          multiline
          maxLength={1000}
          style={[styles.input, { color: text, borderColor: divider }]}
        />
        <PrimaryButton label="Send report" color={accent} onPress={() => void submitReport('other', details)} />
      </>
    );
  } else if (step === 'reported') {
    title = 'Thanks for your report';
    body = (
      <>
        <Text style={[styles.message, { color: muted }]}>
          Our team reviews every report within 24 hours and removes content or players that break our rules.
        </Text>
        {!blockedNow ? (
          <PrimaryButton label={`Also block ${player.name}`} color={danger} onPress={() => void doBlock()} />
        ) : null}
      </>
    );
  } else if (step === 'confirmBlock') {
    title = `Block ${player.name}?`;
    body = (
      <>
        <Text style={[styles.message, { color: muted }]}>
          You won&apos;t see each other in search, friends, leaderboards or notifications, they&apos;ll be removed from
          your friends, and you won&apos;t be matched or challenged. You can unblock them in Profile → Blocked Players.
        </Text>
        <PrimaryButton label="Block" color={danger} onPress={() => void doBlock()} />
      </>
    );
  } else if (step === 'blocked') {
    title = `${player.name} is blocked`;
    body = (
      <Text style={[styles.message, { color: muted }]}>
        You can unblock them any time in Profile → Blocked Players.
      </Text>
    );
  }

  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={[styles.sheet, { backgroundColor: bg }]} onPress={() => {}}>
          <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>
            <Text style={[styles.title, { color: text }]} numberOfLines={2}>
              {title}
            </Text>
            {body}
            {error ? <Text style={[styles.error, { color: danger }]}>{error}</Text> : null}
            <Pressable
              onPress={close}
              disabled={busy}
              style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.6 : 1 }]}
              accessibilityRole="button"
            >
              <Text style={[styles.cancelText, { color: accent }]}>
                {step === 'reported' || step === 'blocked' ? 'Done' : 'Cancel'}
              </Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  trigger: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sheet: { width: '100%', maxWidth: 420, maxHeight: '85%', borderRadius: 18, padding: 20 },
  title: { fontFamily: 'Geist-Bold', fontSize: 18, marginBottom: 12 },
  message: { fontFamily: 'Geist-Regular', fontSize: 14, lineHeight: 20, marginBottom: 14 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionText: { fontFamily: 'Geist-Regular', fontSize: 16, flex: 1 },
  input: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontFamily: 'Geist-Regular',
    fontSize: 15,
    textAlignVertical: 'top',
    marginBottom: 14,
  },
  primaryBtn: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  primaryBtnText: { fontFamily: 'Geist-Bold', fontSize: 16, color: '#FFFFFF' },
  error: { fontFamily: 'Geist-Regular', fontSize: 13, marginTop: 10 },
  cancelBtn: { alignItems: 'center', paddingVertical: 14, marginTop: 6 },
  cancelText: { fontFamily: 'Geist-Bold', fontSize: 16 },
});
