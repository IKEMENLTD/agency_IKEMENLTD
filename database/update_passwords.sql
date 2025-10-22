-- ===================================
-- パスワードハッシュ更新スクリプト
-- 実際のbcryptハッシュ（$2a$10形式）で更新
-- ===================================

-- account1@test-agency.com / Password: Kx9mP#2nQ@7z
UPDATE agency_users
SET password_hash = '$2a$10$JQ6eaccYf1mOTpK9eqC1COe6s6WFNO5514ZloDGSd4oLz5mh8z256'
WHERE email = 'account1@test-agency.com';

-- account2@test-agency.com / Password: Jy3$Rt8Lw&5v
UPDATE agency_users
SET password_hash = '$2a$10$4Vgfo/gLaMEitEL2WZfJrOPIXXWkcVZUZxnQ8QE8LRXUt1XqsEE8u'
WHERE email = 'account2@test-agency.com';

-- account3@test-agency.com / Password: Nm6!Fq4Xp*9s
UPDATE agency_users
SET password_hash = '$2a$10$3aqjkIf0xlBjfkE/bFRoH.F1APJcL9hqDKXOT.jKqIqtj49EiTm62'
WHERE email = 'account3@test-agency.com';

-- account4@test-agency.com / Password: Tz2@Hk7Yw#3b
UPDATE agency_users
SET password_hash = '$2a$10$FRikvQKArYvOrwZAaF5ejeIJ5j2nK4ZFOIig3t2aUkD5mxs0TVG9C'
WHERE email = 'account4@test-agency.com';

-- account5@test-agency.com / Password: Gv8&Cd5Mx!4n
UPDATE agency_users
SET password_hash = '$2a$10$07dgDEjN3LasYvxi4ZGe9.V1imBQ/E4UpLiRfEw1bkck8zAHM.RTK'
WHERE email = 'account5@test-agency.com';

-- account6@test-agency.com / Password: Pq3#Ws9Rb@6j
UPDATE agency_users
SET password_hash = '$2a$10$fSPEMrNK.w5t1Uok/3NrTOgEb8dbc3O4JZUNe1kcZUM1/X6eGBBuW'
WHERE email = 'account6@test-agency.com';

-- account7@test-agency.com / Password: Fx7!Nt2Ky&8m
UPDATE agency_users
SET password_hash = '$2a$10$JCOVYr.Tgp4ue3Rs/ejvqu36VV59zpHz6/84S7vdO2ZgRUKe4jbAi'
WHERE email = 'account7@test-agency.com';

-- account8@test-agency.com / Password: Lz4@Jp6Qw#5c
UPDATE agency_users
SET password_hash = '$2a$10$.XZoHlW/ZXS.ZS167RrxyuYyJ/ZVQB6qK5fC3snJPjcCHXAJz2hcu'
WHERE email = 'account8@test-agency.com';

-- account9@test-agency.com / Password: Dv9&Hs3Tm!7x
UPDATE agency_users
SET password_hash = '$2a$10$SG8pgqVaosmCkc34vsoy9.wTmy9oMZOAb.b4UVf8OrXrZVZZjGcu.'
WHERE email = 'account9@test-agency.com';

-- account10@test-agency.com / Password: Bw5#Yr8Kn@2p
UPDATE agency_users
SET password_hash = '$2a$10$sWG7TFemF/adnFRjCWd3Q.0c18Jh1ljxksFYQPd1ADyzAzizVQ.1a'
WHERE email = 'account10@test-agency.com';

-- 確認用: パスワードが更新されたか確認
SELECT
    au.email,
    au.name,
    LEFT(au.password_hash, 7) as hash_prefix,
    au.is_active,
    a.name as agency_name
FROM agency_users au
JOIN agencies a ON au.agency_id = a.id
WHERE au.email LIKE 'account%@test-agency.com'
ORDER BY au.email;