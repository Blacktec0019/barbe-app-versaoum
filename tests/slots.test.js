import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSlots } from '../src/lib/slots.js';

const DATE = '2026-10-20';
const PAST = new Date('2026-10-01T00:00:00-03:00');
const base = { date: DATE, durationMin: 30, stepMin: 30, minNoticeMin: 30, now: PAST };
const hours = { open_time: '09:00:00', close_time: '12:00:00', break_start: null, break_end: null };
const times = (slots) => slots.map((s) => s.time);

test('dia fechado não tem horários', () => {
  assert.deepEqual(buildSlots({ ...base, hours: undefined }), []);
});

test('gera horários de 30 em 30 até o fechamento', () => {
  assert.deepEqual(times(buildSlots({ ...base, hours })), ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
});

test('serviço de 60 minutos não passa do fechamento', () => {
  assert.deepEqual(times(buildSlots({ ...base, hours, durationMin: 60 })), ['09:00', '09:30', '10:00', '10:30', '11:00']);
});

test('horário ocupado some, inclusive para serviços longos que o atravessam', () => {
  const busy = [{ starts_at: '2026-10-20T10:00:00-03:00', ends_at: '2026-10-20T10:30:00-03:00' }];
  assert.ok(!times(buildSlots({ ...base, hours, busy })).includes('10:00'));
  const long = times(buildSlots({ ...base, hours, busy, durationMin: 60 }));
  assert.ok(!long.includes('09:30') && !long.includes('10:00'));
  assert.ok(long.includes('09:00') && long.includes('10:30'));
});

test('respeita o intervalo', () => {
  const h = { open_time: '09:00:00', close_time: '15:00:00', break_start: '12:00:00', break_end: '13:00:00' };
  const t = times(buildSlots({ ...base, hours: h, durationMin: 60 }));
  assert.ok(!t.includes('11:30') && !t.includes('12:00') && !t.includes('12:30'));
  assert.ok(t.includes('11:00') && t.includes('13:00'));
});

test('respeita a antecedência mínima', () => {
  const now = new Date('2026-10-20T09:50:00-03:00');
  assert.equal(buildSlots({ ...base, hours, now })[0].time, '10:30');
});

test('startsAt sai com o fuso de Brasília', () => {
  assert.equal(buildSlots({ ...base, hours })[0].startsAt, '2026-10-20T09:00:00-03:00');
});
