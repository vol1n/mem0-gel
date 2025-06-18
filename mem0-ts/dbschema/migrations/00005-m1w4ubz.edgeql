CREATE MIGRATION m1w4ubzfjdbci5dtjb2hoka234bnbahoy3outye4juijlzmwwtxvrq
    ONTO m1rnojvox66a63ocum3rehkaqs4uioa7eq7skwrefcsx3fteaitiba
{
  ALTER TYPE mem0::MemoryImpl {
      CREATE REQUIRED PROPERTY mem0_id: std::str {
          SET REQUIRED USING (<std::str>{''});
          CREATE CONSTRAINT std::exclusive;
      };
  };
};
