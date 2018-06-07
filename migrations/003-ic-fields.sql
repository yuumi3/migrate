-- Up
create table ic_fields (
    id SERIAL PRIMARY key,
    date_created timestamp,
    ic_pkg_id TEXT,
    dcn TEXT,
    field_xpath TEXT,
    field_value TEXT,
    lender TEXT,
    confidence TEXT
);

-- Down
drop table ic_fields;
