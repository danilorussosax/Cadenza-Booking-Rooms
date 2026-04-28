'use strict';
require('dotenv').config();
(async () => {
  const m = require('../models');
  const u = await m.User.findAll({
    paranoid: false,
    attributes: ['id', 'email', 'firstName', 'lastName', 'role', 'createdAt', 'deletedAt'],
  });
  console.log('USERS (incl. soft-deleted):');
  for (const x of u)
    console.log(
      ' ',
      x.id,
      x.email,
      x.role,
      x.createdAt?.toISOString(),
      x.deletedAt ? 'DELETED' : '',
    );

  const i = await m.Institute.findAll({
    paranoid: false,
    attributes: ['id', 'name', 'createdAt', 'deletedAt'],
  });
  console.log('\nINSTITUTES:');
  for (const x of i)
    console.log(' ', x.id, x.name, x.createdAt?.toISOString(), x.deletedAt ? 'DELETED' : '');

  const b = await m.Building.findAll({
    paranoid: false,
    attributes: ['id', 'name', 'instituteId', 'createdAt', 'deletedAt'],
  });
  console.log('\nBUILDINGS:');
  for (const x of b)
    console.log(
      ' ',
      x.id,
      x.name,
      'inst=' + x.instituteId,
      x.createdAt?.toISOString(),
      x.deletedAt ? 'DELETED' : '',
    );

  const r = await m.Room.findAll({
    paranoid: false,
    attributes: ['id', 'name', 'buildingId', 'createdAt', 'deletedAt'],
  });
  console.log('\nROOMS:');
  for (const x of r)
    console.log(
      ' ',
      x.id,
      x.name,
      'bld=' + x.buildingId,
      x.createdAt?.toISOString(),
      x.deletedAt ? 'DELETED' : '',
    );

  const c = await m.Course.findAll({
    paranoid: false,
    attributes: ['id', 'name', 'code', 'createdAt', 'deletedAt'],
  });
  console.log('\nCOURSES:');
  if (!c.length) console.log('  (vuoto)');
  for (const x of c)
    console.log(
      ' ',
      x.id,
      x.code,
      x.name,
      x.createdAt?.toISOString(),
      x.deletedAt ? 'DELETED' : '',
    );

  const bk = await m.Booking.findAll({
    paranoid: false,
    attributes: ['id', 'userId', 'roomId', 'startTime', 'status', 'createdAt', 'deletedAt'],
  });
  console.log('\nBOOKINGS:');
  if (!bk.length) console.log('  (vuoto)');
  for (const x of bk)
    console.log(
      ' ',
      x.id,
      'u=' + x.userId,
      'r=' + x.roomId,
      x.startTime,
      x.status,
      x.deletedAt ? 'DELETED' : '',
    );

  const mp = await m.MonteOreProposal.findAll({
    paranoid: false,
    attributes: ['id', 'userId', 'academicYear', 'status', 'createdAt'],
  });
  console.log('\nMONTE ORE PROPOSALS:');
  for (const x of mp)
    console.log(' ', x.id, 'u=' + x.userId, x.academicYear, x.status, x.createdAt?.toISOString());

  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
