import { useState } from 'react';
import {
  Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSync } from '@/lib/sync';
import { colors, radius, space, timeAgo, type } from '@/lib/theme';
import { Button } from '@/components/ui';

/**
 * The sync tray — the app's answer to "did that actually send?".
 *
 * A responder who taps On Scene in a basement and sees the screen change has
 * been told the job is done. If the write is actually sitting in a queue, that
 * is a lie by omission, and it is the kind that gets discovered during an
 * inquiry rather than during a shift. So anything undelivered is visible, with
 * a count, permanently, until it goes.
 *
 * It stays out of the way when there is nothing to say: no pill when the queue
 * is empty and the phone is online.
 */
export function SyncTray() {
  const { pending, failed, online, syncing, retryAll, discard, describeOp } = useSync();
  const [open, setOpen] = useState(false);

  const total = pending.length + failed.length;
  if (total === 0 && online) return null;

  const tone = failed.length > 0
    ? colors.critical
    : !online
      ? colors.medium
      : colors.accent;

  const label = failed.length > 0
    ? `${failed.length} not sent`
    : total > 0
      ? `${total} waiting${online ? '' : ' · offline'}`
      : 'Offline';

  const confirmDiscard = (id: string, what: string) => {
    Alert.alert(
      'Discard this update?',
      `"${what}" will be deleted and never reaches the case file. Only do this if you are certain it is no longer needed.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => void discard(id) },
      ],
    );
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Sync status: ${label}`}
        style={({ pressed }) => [
          styles.pill,
          { borderColor: `${tone}88`, backgroundColor: `${tone}22` },
          pressed && { opacity: 0.8 },
        ]}
      >
        <Ionicons
          name={
            failed.length > 0 ? 'warning'
              : !online ? 'cloud-offline-outline'
                : syncing ? 'sync' : 'cloud-upload-outline'
          }
          size={14}
          color={tone}
        />
        <Text style={[styles.pillText, { color: tone }]}>{label}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.scrim}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Waiting to send</Text>
                <Text style={styles.sheetSub}>
                  {online
                    ? 'Connected — these are being delivered now.'
                    : 'No connection. Everything here is stored on the phone and sends itself when signal returns.'}
                </Text>
              </View>
              <Pressable onPress={() => setOpen(false)} hitSlop={12} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: space.lg }}>
              {total === 0 ? (
                <Text style={styles.empty}>Everything has been delivered.</Text>
              ) : null}

              {[...failed, ...pending].map((entry) => {
                const isFailed = entry.status === 'failed';
                return (
                  <View
                    key={entry.id}
                    style={[styles.row, isFailed && { borderColor: `${colors.critical}55` }]}
                  >
                    <Ionicons
                      name={isFailed ? 'alert-circle' : 'time-outline'}
                      size={16}
                      color={isFailed ? colors.critical : colors.muted}
                      style={{ marginTop: 2 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{describeOp(entry.op)}</Text>
                      <Text style={styles.rowMeta}>
                        Captured {timeAgo(entry.occurredAt)}
                        {entry.attempts > 0 ? ` · ${entry.attempts} attempt${entry.attempts === 1 ? '' : 's'}` : ''}
                      </Text>
                      {isFailed && entry.lastError ? (
                        <Text style={styles.rowError} numberOfLines={3}>{entry.lastError}</Text>
                      ) : null}
                    </View>
                    {isFailed ? (
                      <Pressable
                        onPress={() => confirmDiscard(entry.id, describeOp(entry.op))}
                        hitSlop={10}
                        accessibilityLabel="Discard this update"
                      >
                        <Ionicons name="trash-outline" size={16} color={colors.muted} />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.sheetFoot}>
              <Button
                label={syncing ? 'Sending…' : 'Try again now'}
                icon="refresh"
                variant="outline"
                busy={syncing}
                disabled={total === 0}
                onPress={() => void retryAll()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    // Clear of the tab bar so it never covers a navigation target.
    bottom: 96,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    backgroundColor: colors.bgCard,
    zIndex: 90,
  },
  pillText: { fontSize: 12, fontWeight: '700' },

  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgCard,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.border,
    maxHeight: '80%',
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.xl,
    paddingBottom: space.md,
  },
  sheetTitle: { ...type.h1, color: colors.text },
  sheetSub: { ...type.small, color: colors.muted, marginTop: 4, lineHeight: 19 },

  list: { paddingHorizontal: space.xl },
  empty: { ...type.small, color: colors.muted, paddingVertical: space.lg },

  row: {
    flexDirection: 'row',
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
    backgroundColor: colors.bgSoft,
  },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  rowMeta: { ...type.small, fontSize: 12, color: colors.muted, marginTop: 2 },
  rowError: { ...type.small, fontSize: 12, color: colors.critical, marginTop: 4, lineHeight: 17 },

  sheetFoot: {
    padding: space.xl,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
