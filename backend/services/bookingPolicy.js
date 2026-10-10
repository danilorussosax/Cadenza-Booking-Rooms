'use strict';
const { User } = require('../models');
const { sendBookingEmail } = require('./emailService');

function bookingStatus(room, actor) {
  return room?.requiresApproval && actor.role !== 'admin' ? 'pending_approval' : 'confirmed';
}

async function notifyAdminsOfPendingBooking(booking) {
  const admins = await User.findAll({
    where: { role: 'admin', isActive: true },
    attributes: [
      'id',
      'firstName',
      'lastName',
      'email',
      'emailNotifications',
      'notifyOnConfirmation',
    ],
  });
  await Promise.all(
    admins
      .filter((a) => a.email && a.emailNotifications !== false)
      .map((admin) =>
        sendBookingEmail({
          user: admin,
          booking,
          kind: 'booking_pending_admin',
          // requester info embedded nel context: il template legge user.* in
          // intestazione, quindi sostituiamo lo "user" con il richiedente
          // mantenendo l'email di destinazione = admin.email.
          extra: {
            requesterName:
              `${booking.user?.firstName ?? ''} ${booking.user?.lastName ?? ''}`.trim(),
            requesterEmail: booking.user?.email ?? '',
          },
        }).catch(() => {}),
      ),
  );
}

module.exports = { bookingStatus, notifyAdminsOfPendingBooking };
