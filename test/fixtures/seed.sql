create table customers (
  id serial primary key,
  email text not null unique,
  created_at timestamptz not null default '2026-01-01T00:00:00Z'
);
insert into customers (email) select 'user' || g || '@example.com' from generate_series(1, 2000) g;

create table orders (
  id serial primary key,
  customer_id integer not null references customers (id),
  total_cents integer not null,
  note text not null
);
insert into orders (customer_id, total_cents, note)
  select 1 + (g % 2000), (g * 37) % 100000, md5(g::text) from generate_series(1, 20000) g;

create table events (
  id bigserial primary key,
  payload jsonb not null
);
insert into events (payload) select jsonb_build_object('n', g, 'tag', 'e' || (g % 7)) from generate_series(1, 5000) g;

create view order_totals as
  select customer_id, count(*) as orders, sum(total_cents) as total_cents from orders group by customer_id;
