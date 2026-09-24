// Pure rules for roles, badges and restrictions. No database or Express here,
// so every decision about "who may do what to whom" lives in one small,
// testable place.

const ROLES = ['player', 'moderator', 'admin'];
const RANK = { player: 1, moderator: 2, admin: 3 };

const RESTRICTION_STATES = ['none', 'suspended', 'banned'];
const MAX_SUSPEND_HOURS = 24 * 365; // one year; anything longer should be a ban
const REASON_MIN = 3;
const REASON_MAX = 200;

// The role is stored as a plain string in MongoDB ("admin", "moderator",
// "player"). Someone typing it by hand in Atlas might add a capital letter or
// a space, so it is normalised on read. Anything unrecognised counts as a
// normal player, never as staff.
const normalizeRole = (value) => {
  const r = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  return RANK[r] ? r : 'player';
};

const rankOf = (role) => RANK[normalizeRole(role)];
const isStaff = (role) => rankOf(role) >= RANK.moderator;

// A moderator can act on players. An admin can act on players and moderators.
// Nobody can act on someone of equal or higher rank (so admins are safe from
// each other and from moderators).
const canModerate = (actorRole, targetRole) =>
  rankOf(actorRole) >= RANK.moderator && rankOf(actorRole) > rankOf(targetRole);

// Only admins hand out or take back the moderator role, only between
// "player" and "moderator". Admins are created by hand in the database.
const canAssignRole = (actorRole, targetRole, newRole) =>
  normalizeRole(actorRole) === 'admin' &&
  ['player', 'moderator'].includes(String(newRole)) &&
  ['player', 'moderator'].includes(normalizeRole(targetRole));

// What the profile badge shows. Change it here to change it everywhere.
const badgeFor = (role) => {
  const r = normalizeRole(role);
  return r === 'admin' ? 'admin' : r === 'moderator' ? 'moderator' : null;
};

// 'banned' | 'suspended' | 'active'. A suspension whose end time has passed
// simply counts as active, so nothing has to run to lift it.
const restrictionStatus = (restriction, now = Date.now()) => {
  if (!restriction) return 'active';
  if (restriction.state === 'banned') return 'banned';
  if (restriction.state === 'suspended' && restriction.until && new Date(restriction.until).getTime() > now) {
    return 'suspended';
  }
  return 'active';
};

const parseSuspendHours = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > MAX_SUSPEND_HOURS) return null;
  return Math.round(n);
};

const cleanReason = (value) => {
  const s = String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
  return s.length >= REASON_MIN && s.length <= REASON_MAX ? s : null;
};

module.exports = {
  ROLES,
  RANK,
  RESTRICTION_STATES,
  MAX_SUSPEND_HOURS,
  REASON_MIN,
  REASON_MAX,
  normalizeRole,
  rankOf,
  isStaff,
  canModerate,
  canAssignRole,
  badgeFor,
  restrictionStatus,
  parseSuspendHours,
  cleanReason,
};
