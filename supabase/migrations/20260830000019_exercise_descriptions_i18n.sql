-- ============================================================
-- Roxlogy — 시스템 감사 수리 (7) 운동 설명 다국어
--
-- 운동 상세의 '수행 방법'이 description_ko 하나뿐이라 en/es 사용자에게
-- 한국어 본문이 그대로 노출됐다. name_ko/name_en 과 같은 패턴으로
-- description_en·description_es 를 추가하고 78종 전부를 채운다.
-- 화면은 로케일에 맞는 설명을 고르고, 없으면 영어→한국어 순으로 폴백한다.
-- ============================================================

alter table public.exercises
  add column if not exists description_en text,
  add column if not exists description_es text;

update exercises e set
  description_en = v.en,
  description_es = v.es
from (values
  ('90/90 Hip Stretch', 'Sit with both legs bent at 90 degrees, torso tall, to open the front hip. Alternate sides.', 'Siéntate con ambas piernas a 90 grados y el torso erguido para abrir la cadera delantera. Alterna lados.'),
  ('Ab Wheel Rollout', 'From your knees, roll the wheel forward until nearly extended, then pull back with the core. Do not let the lower back arch.', 'De rodillas, rueda la rueda hacia delante hasta casi extenderte y vuelve con el core. No arquees la zona lumbar.'),
  ('Air Runner', 'Drive the knees and swing the arms like a runner to raise the heart rate, in place or moving forward.', 'Eleva las rodillas y mueve los brazos como al correr para subir pulsaciones, en el sitio o avanzando.'),
  ('American KB Swing', 'Hinge at the hips to send the kettlebell between the legs, then swing it overhead with hip drive.', 'Haz bisagra de cadera para llevar la pesa entre las piernas y proyéctala por encima de la cabeza con la cadera.'),
  ('Assault Bike', 'Push and pull with arms and legs together, holding a steady power output.', 'Empuja y tira con brazos y piernas a la vez, manteniendo una potencia constante.'),
  ('Back Squat', 'With the bar on your upper back, push the hips back and squat until the thighs are parallel, then stand.', 'Con la barra en la espalda alta, lleva la cadera atrás y baja hasta que los muslos queden paralelos; sube.'),
  ('Band Shoulder Warmup', 'Hold a band and circle the arms front to back and side to side to warm up the shoulder joint.', 'Sujeta una banda y gira los brazos adelante-atrás y a los lados para calentar el hombro.'),
  ('Barbell Row', 'Hinge at the hips and pull the bar toward your navel. Feel the pull in the back.', 'Haz bisagra de cadera y tira de la barra hacia el ombligo. Siente el tirón en la espalda.'),
  ('Battle Ropes', 'With knees softly bent, whip the ropes alternately and fast to create waves.', 'Con las rodillas algo flexionadas, golpea las cuerdas alternando rápido para crear olas.'),
  ('Bench Press', 'Squeeze the shoulder blades, lower the bar to the chest and press it back up.', 'Junta las escápulas, baja la barra al pecho y empuja hacia arriba.'),
  ('Box Jumps', 'Load the hips back, jump explosively onto the box, stand fully, then step down.', 'Carga la cadera atrás, salta con fuerza al cajón, extiéndete por completo y baja.'),
  ('Bulgarian Split Squat', 'With the rear foot on a bench, squat and stand on the front leg. Builds single-leg strength and balance.', 'Con el pie trasero en un banco, baja y sube con la pierna delantera. Fuerza y equilibrio unilateral.'),
  ('Burpee Broad Jumps', 'Chest to the floor, stand up and jump forward as far as you can. Flow straight into the next burpee on landing.', 'Pecho al suelo, levántate y salta hacia delante lo máximo posible. Encadena el siguiente burpee al caer.'),
  ('Calf Raise', 'Rise onto the toes as high as possible, then lower the heels slowly.', 'Elévate sobre las puntas lo máximo posible y baja los talones despacio.'),
  ('Calf Stretch', 'Push against a wall with the back leg straight to stretch the calf. Bend the knee to reach the soleus too.', 'Empuja contra la pared con la pierna trasera estirada para elongar el gemelo. Flexiona la rodilla para el sóleo.'),
  ('Chin Ups', 'With palms facing you, pull up until the chin clears the bar.', 'Con las palmas hacia ti, tira hasta pasar la barbilla por encima de la barra.'),
  ('Clean & Jerk', 'Clean the bar from the floor to the shoulders, then jerk it overhead.', 'Lleva la barra del suelo a los hombros y proyéctala por encima de la cabeza.'),
  ('Compromised Run', 'Run immediately after strength work to rehearse the tired legs of race day.', 'Corre justo después del trabajo de fuerza para simular las piernas cansadas de la competición.'),
  ('Couch Stretch', 'Kneel with the rear foot against a wall to stretch the quad and hip flexor.', 'Arrodíllate con el pie trasero contra la pared para estirar cuádriceps y flexor de cadera.'),
  ('Dead Hang', 'Hang relaxed from the bar to build grip endurance and decompress the shoulders.', 'Cuélgate relajado de la barra para ganar resistencia de agarre y descomprimir los hombros.'),
  ('Deadlift', 'Keep the bar close to the shins and drive it off the floor with a hip hinge. Keep the back neutral.', 'Mantén la barra pegada a las espinillas y despégala del suelo con bisagra de cadera. Espalda neutra.'),
  ('Devil Press', 'Holding dumbbells, do a burpee then snatch both overhead. Full-body power and conditioning at once.', 'Con mancuernas, haz un burpee y llévalas por encima de la cabeza. Potencia y acondicionamiento a la vez.'),
  ('Dips', 'On parallel bars, lower until the elbows reach 90 degrees, then press back up.', 'En paralelas, baja hasta 90 grados de codo y empuja hacia arriba.'),
  ('Double Unders', 'Spin the rope from the wrists so it passes twice per jump. Keep the jump low and quick.', 'Gira la cuerda con las muñecas para que pase dos veces por salto. Salto bajo y rápido.'),
  ('Dumbbell Row', 'With one hand on a bench, pull the dumbbell toward the hip. Squeeze the shoulder blade and use the back.', 'Con una mano en el banco, tira de la mancuerna hacia la cadera. Junta la escápula y usa la espalda.'),
  ('Farmers Carry', 'Carry the weight at your sides, shoulders tall and core braced, and walk fast. Grip is the limiter.', 'Lleva el peso a los lados, hombros erguidos y core activo, y camina rápido. El agarre es el límite.'),
  ('Foam Roll Quads', 'Place the front of the thigh on the roller and roll slowly to release the fascia.', 'Apoya la parte delantera del muslo en el rodillo y rueda despacio para liberar la fascia.'),
  ('Foam Roll T-Spine', 'Put the mid-back on the roller and extend and flex the thoracic spine to gain mobility.', 'Coloca la espalda media sobre el rodillo y extiende y flexiona la columna torácica para ganar movilidad.'),
  ('Front Rack Carry', 'Hold the kettlebells in the front rack position and walk with the core tall.', 'Sujeta las pesas en posición de rack frontal y camina con el core erguido.'),
  ('Front Squat', 'With the bar on the front of the shoulders and elbows high, squat keeping the torso upright.', 'Con la barra en los hombros y los codos altos, haz sentadilla manteniendo el torso vertical.'),
  ('Glute Bridge', 'Lying on your back, drive through the feet to lift the hips and squeeze the glutes.', 'Tumbado boca arriba, empuja con los pies para elevar la cadera y aprieta los glúteos.'),
  ('Goblet Squat', 'Hold a kettlebell at the chest and squat deep with the torso upright.', 'Sujeta una pesa rusa al pecho y haz sentadilla profunda con el torso erguido.'),
  ('Hanging Leg Raise', 'Hang from the bar and raise the legs without swinging. Trains the core and grip together.', 'Cuelga de la barra y sube las piernas sin balanceo. Trabaja core y agarre a la vez.'),
  ('Hill Sprints', 'Sprint up the hill all-out and walk down to recover. Builds power and running economy.', 'Esprinta cuesta arriba al máximo y baja andando para recuperar. Desarrolla potencia y economía de carrera.'),
  ('Hip Flexor Stretch', 'From a lunge, push the pelvis forward to stretch the rear-leg hip flexor.', 'Desde una zancada, empuja la pelvis hacia delante para estirar el flexor de la pierna trasera.'),
  ('Hip Thrust', 'Back on a bench and bar across the hips, drive the hips up. Glute power.', 'Con la espalda en un banco y la barra sobre la cadera, empuja hacia arriba. Potencia de glúteo.'),
  ('Hollow Hold', 'Press the lower back into the floor and hold arms and legs extended in a banana shape.', 'Pega la zona lumbar al suelo y mantén brazos y piernas extendidos en forma de plátano.'),
  ('Interval Run', 'Alternate fast efforts with recovery jogs to build speed and lactate tolerance.', 'Alterna tramos rápidos con trote de recuperación para ganar velocidad y tolerancia al lactato.'),
  ('Kettlebell Swings', 'Hinge at the hips to send the kettlebell between the legs, then swing it to shoulder height with hip drive.', 'Haz bisagra de cadera para llevar la pesa entre las piernas y proyéctala a la altura del hombro.'),
  ('Leg Press', 'Seated in the machine, press the platform to extend the legs and lower under control.', 'Sentado en la máquina, empuja la plataforma para extender las piernas y baja controlando.'),
  ('Man Makers', 'A full-body complex: dumbbell burpee into row, clean and press.', 'Complejo de cuerpo completo: burpee con mancuernas, remo, cargada y press.'),
  ('Nordic Curl', 'With the ankles anchored and the torso straight, lower slowly forward, resisting with the hamstrings.', 'Con los tobillos fijos y el torso recto, baja despacio hacia delante resistiendo con los isquiotibiales.'),
  ('Overhead Carry', 'Hold the weight overhead with the arms locked and walk with the core braced. Shoulder stability.', 'Sostén el peso por encima de la cabeza con los brazos bloqueados y camina con el core activo. Estabilidad de hombro.'),
  ('Overhead Press', 'Press the bar from the shoulders to overhead with no leg drive. Brace the torso with the core.', 'Empuja la barra desde los hombros hasta arriba sin impulso de piernas. Estabiliza el torso con el core.'),
  ('Pallof Press', 'Resist the band pulling from the side and extend the arms without letting the torso rotate (anti-rotation).', 'Resiste la banda que tira desde el lado y extiende los brazos sin dejar que el torso rote (antirrotación).'),
  ('Pec Stretch', 'Place the arm on a doorframe or wall and turn the body away to open the chest.', 'Apoya el brazo en el marco de una puerta o pared y gira el cuerpo para abrir el pecho.'),
  ('Plank', 'Support the body in a straight line on the elbows and toes. Brace the core so the hips do not sag.', 'Sostén el cuerpo en línea recta sobre codos y puntas. Activa el core para que la cadera no caiga.'),
  ('Power Clean', 'From the hip hinge, pull the bar explosively and catch it on the shoulders. Triple-extension power.', 'Desde la bisagra de cadera, tira de la barra explosivamente y recíbela en los hombros. Potencia de triple extensión.'),
  ('Pull Ups', 'With an overhand grip, depress the shoulder blades and pull until the chin clears the bar.', 'Con agarre prono, desciende las escápulas y tira hasta pasar la barbilla por encima de la barra.'),
  ('Push Press', 'Use a small dip of the legs to drive the bar overhead.', 'Usa un pequeño impulso de piernas para llevar la barra por encima de la cabeza.'),
  ('Push Ups', 'Keep the body in a straight line, lower until the chest reaches the floor and press back up.', 'Mantén el cuerpo en línea recta, baja hasta que el pecho toque el suelo y empuja.'),
  ('Romanian Deadlift', 'With knees softly bent, hinge to lower the bar to the shins, stretching the hamstrings, then stand.', 'Con las rodillas algo flexionadas, baja la barra hasta las espinillas estirando los isquiotibiales y sube.'),
  ('Rowing', 'Drive with the legs first, then swing the torso back and finish with the arms (legs-hips-arms). Reverse the order on the recovery.', 'Empuja primero con las piernas, luego inclina el torso y termina con los brazos (piernas-cadera-brazos). Invierte el orden al volver.'),
  ('Running', 'Hold your target pace with a steady cadence and breathing.', 'Mantén el ritmo objetivo con una cadencia y respiración constantes.'),
  ('Russian Twist', 'Seated with the torso leaned back, move the medicine ball side to side, rotating the trunk.', 'Sentado con el torso inclinado atrás, mueve el balón medicinal de lado a lado rotando el tronco.'),
  ('Sandbag Lunges', 'Carry the sandbag on the shoulders and lunge forward until the back knee touches the floor, torso tall.', 'Lleva el saco sobre los hombros y avanza en zancadas hasta que la rodilla trasera toque el suelo, torso erguido.'),
  ('Sandbag Shoulder Carry', 'Carry the sandbag on one shoulder and walk, balancing with the core.', 'Lleva el saco sobre un hombro y camina, equilibrando con el core.'),
  ('Side Plank', 'Lying on your side, support the body in a straight line on one elbow. Strengthens the lateral core.', 'Tumbado de lado, sostén el cuerpo en línea recta sobre un codo. Refuerza el core lateral.'),
  ('SkiErg', 'Put your body weight into the handles, pull hard to the hips and fold and extend the torso with the core. Link legs, core and arms rhythmically.', 'Carga tu peso sobre las asas, tira con fuerza hasta la cadera y flexiona y extiende el torso con el core. Enlaza piernas, core y brazos con ritmo.'),
  ('Slam Balls', 'Lift the ball overhead and slam it into the floor with the core and upper body.', 'Eleva el balón por encima de la cabeza y golpéalo contra el suelo con el core y el tren superior.'),
  ('Sled Pull', 'Lean your weight back, pull the rope hand over hand and press into the floor with the feet.', 'Inclina tu peso hacia atrás, tira de la cuerda mano sobre mano y presiona el suelo con los pies.'),
  ('Sled Push', 'Stay low with the arms extended, drive hard into the ground and advance with short, quick steps.', 'Mantente bajo con los brazos extendidos, empuja con fuerza contra el suelo y avanza con pasos cortos y rápidos.'),
  ('Snatch', 'Pull the bar from the floor to overhead in one movement. The most technical full-body power lift.', 'Lleva la barra del suelo por encima de la cabeza en un solo movimiento. El levantamiento de potencia más técnico.'),
  ('Steady State Run', 'Run long at a comfortable, conversational pace to build the aerobic base.', 'Corre largo a un ritmo cómodo y conversacional para construir la base aeróbica.'),
  ('Step Ups', 'Place one foot on the box and drive up with that leg, then step back down.', 'Coloca un pie en el cajón, sube con esa pierna y baja.'),
  ('Suitcase Carry', 'Carry the weight in one hand only and walk without letting the body tilt (anti-lateral flexion).', 'Lleva el peso en una sola mano y camina sin dejar que el cuerpo se incline (antiflexión lateral).'),
  ('Tempo Run', 'Run continuously at threshold pace — comfortably hard, without breaks.', 'Corre de forma continua a ritmo de umbral: cómodamente duro, sin pausas.'),
  ('Thrusters', 'Drive out of a front squat to press the bar overhead. The key pattern behind wall balls.', 'Sal de una sentadilla frontal para empujar la barra por encima de la cabeza. El patrón clave del wall ball.'),
  ('Toes to Bar', 'Hang from the bar and use the kip to touch your toes to the bar.', 'Cuelga de la barra y usa el balanceo para tocar la barra con las puntas de los pies.'),
  ('Trap Bar Deadlift', 'Stand inside the trap bar, grip the handles and lift with the legs and back. Easier on the lower back.', 'Colócate dentro de la barra hexagonal, agarra las asas y levanta con piernas y espalda. Menos carga lumbar.'),
  ('Treadmill Intervals', 'Run intervals indoors by adjusting treadmill speed and incline.', 'Haz intervalos en interior ajustando velocidad e inclinación de la cinta.'),
  ('V-Ups', 'Lying down, raise arms and legs together into a V, then lower under control.', 'Tumbado, eleva brazos y piernas a la vez formando una V y baja controlando.'),
  ('Walking Lunge', 'Holding dumbbells, walk forward lunging until the back knee touches the floor.', 'Con mancuernas, avanza en zancadas hasta que la rodilla trasera toque el suelo.'),
  ('Wall Ankle Mobility', 'Drive the knee toward the wall to increase ankle dorsiflexion range.', 'Lleva la rodilla hacia la pared para aumentar el rango de dorsiflexión del tobillo.'),
  ('Wall Balls', 'Drive out of the squat to throw the ball to the target (3 m men / 2.7 m women), catch it on the way down and squat straight away.', 'Sal de la sentadilla para lanzar el balón al objetivo (3 m hombres / 2,7 m mujeres), recíbelo al bajar y encadena la sentadilla.'),
  ('Wall Walks', 'From a prone position, put the feet on the wall and walk the hands in toward a near-handstand.', 'Desde tumbado boca abajo, apoya los pies en la pared y camina con las manos hacia una casi vertical.'),
  ('World''s Greatest Stretch', 'From a lunge, drop the elbow to the floor inside the front foot and rotate the torso to open the whole body.', 'Desde una zancada, baja el codo al suelo por dentro del pie delantero y rota el torso para abrir todo el cuerpo.'),
  ('Yoke Carry', 'Carry the yoke on the shoulders with short, fast steps. Whole-body stability and grip.', 'Lleva el yugo sobre los hombros con pasos cortos y rápidos. Estabilidad global y agarre.')
) as v(name_en, en, es)
where e.name_en = v.name_en;

do $$
declare v_missing int;
begin
  select count(*) into v_missing from exercises
  where description_ko is not null and description_en is null;
  if v_missing > 0 then
    raise exception '% exercises still lack an English description', v_missing;
  end if;
end $$;
