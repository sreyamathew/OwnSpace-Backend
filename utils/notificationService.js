const Notification = require('../models/Notification');
const User = require('../models/User');
const { emitToUser } = require('./socket');

const serializeDoc = (doc) => (doc?.toObject ? doc.toObject() : doc);

const emitUnreadCount = async (userId) => {
  if (!userId) return 0;
  const unreadCount = await Notification.countDocuments({ userId, isRead: false });
  emitToUser(userId, 'notifications:unreadCount', { unreadCount });
  return unreadCount;
};

const createNotification = async ({ userId, type, title, message, metadata }) => {
  if (!userId || !type || !title || !message) return null;
  const doc = await Notification.create({ userId, type, title, message, metadata });
  const payload = serializeDoc(doc);
  emitToUser(userId, 'notifications:new', payload);
  await emitUnreadCount(userId);
  return payload;
};

const createNotifications = async (items = []) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  const valid = items.filter((item) => item?.userId && item.type && item.title && item.message);
  if (valid.length === 0) return [];
  const docs = await Notification.insertMany(valid, { ordered: false });
  const serialized = docs.map(serializeDoc);
  const userIds = new Set();
  serialized.forEach((doc) => {
    userIds.add(String(doc.userId));
    emitToUser(doc.userId, 'notifications:new', doc);
  });
  await Promise.all(Array.from(userIds).map((id) => emitUnreadCount(id)));
  return serialized;
};

const markNotificationsRead = async (userId, ids = []) => {
  if (!userId) return { modifiedCount: 0 };
  const filter = { userId, isRead: false };
  if (Array.isArray(ids) && ids.length > 0) {
    filter._id = { $in: ids };
  }
  const result = await Notification.updateMany(filter, { $set: { isRead: true } });
  await emitUnreadCount(userId);
  return result;
};

const notifyAdmins = async (type, title, message, metadata) => {
  const admins = await User.find({ userType: 'admin' }).select('_id');
  if (!admins || admins.length === 0) return [];
  const items = admins.map((admin) => ({ userId: admin._id, type, title, message, metadata }));
  return createNotifications(items);
};

module.exports = {
  createNotification,
  createNotifications,
  markNotificationsRead,
  notifyAdmins,
  emitUnreadCount
};
