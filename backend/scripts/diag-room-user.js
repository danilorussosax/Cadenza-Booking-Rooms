'use strict';
require('dotenv').config();
(async () => {
  const m = require('../models');
  const r = await m.Room.findByPk(4, { include: [{ model: m.Building, as: 'building' }] });
  console.log('Room 4:', r ? JSON.stringify(r.toJSON(), null, 2).slice(0, 800) : 'NOT FOUND');
  console.log();
  const u = await m.User.findByPk(4);
  console.log(
    'User 4:',
    u
      ? JSON.stringify({
          id: u.id,
          email: u.email,
          role: u.role,
          status: u.status,
          courseId: u.courseId,
          isActive: u.isActive,
        })
      : 'NOT FOUND',
  );
  console.log();
  const p = await m.MonteOreProposal.findByPk(3);
  console.log('Proposta 3 generationSummary:');
  console.log(JSON.stringify(p?.generationSummary, null, 2)?.slice(0, 2000));
  process.exit(0);
})().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});
