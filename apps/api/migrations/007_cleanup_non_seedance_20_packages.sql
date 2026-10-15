DELETE FROM provider_resource_packages
WHERE provider = 'volcengine-ark'
  AND (
    total_quota <= 0
    OR recognized_model NOT IN ('Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 2.0 Mini')
    OR lower(config) NOT LIKE '%seedance%'
    OR lower(config) NOT LIKE '%2.0%'
  );
